import {
  AiParsedFoodItemsSchema,
  type AiParsedFoodItem,
} from '@/lib/food-contract';

const REQUEST_TIMEOUT_MS = 25_000;
const MAX_ATTEMPTS = 1;
const RETRY_DELAY_MS = 1_500;

const SYSTEM_PROMPT = `
你是中文饮食记录助手。
只在本地营养数据库无法直接命中整句描述时，帮后端把用户的一句话饮食描述拆成最终可查库的食物条目。

目标：
1. 尽量输出容易命中数据库的通用中文食物名或菜名。
2. 单一食品、品牌食品、完整成品如果本身就是独立食物，例如“麦旋风”“可乐”“纯牛奶”“肉包子”，可直接作为一个条目返回。
3. 复合菜、组合餐、炒饭、盖饭、拌面、三明治、汉堡、沙拉、便当这类食物，要直接拆成基础组成项再返回，例如主食 + 主要蛋白质 + 少量明显配菜。
4. 估算每个条目这次实际吃下的总克重。
5. 额外给出每100g四项营养，作为数据库未命中时的兜底值。

要求：
- 只返回 JSON 数组，不要解释，不要 Markdown。
- estimatedGrams 必须是每个条目这次总摄入重量，不是单个重量。
- quantityDescription 保留关键量词；没有明确数量时写“未知”。
- fallbackPer100g 只包含 energyKcal、proteinGrams、carbohydrateGrams、fatGrams。
- 一句话里有多个食物时拆成多个元素。
- 如果用户说的是复合菜，直接输出拆解后的组成项，不要先输出整道菜再让后端二次拆。
- 像“火腿蛋炒饭”这类食物，通常应拆为“米饭 + 鸡蛋 + 火腿肠/火腿 + 少量蔬菜或油”；不要把整道菜误判成单一“火腿”。
- 如果用户提供了总克重，例如“400g火腿蛋炒饭”，拆解后的 estimatedGrams 加总应尽量接近总克重。
- 对品牌名、口语化描述做适度归一，例如“小肉包”可归一为“鲜肉包子”。
`;

const RESPONSE_JSON_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      foodName: {
        type: 'string',
        description: '通用中文食物名或菜名，优先选择容易查营养库的写法。',
      },
      quantityDescription: {
        type: 'string',
        description: '原句中的数量描述；没有明确数量时写“未知”。',
      },
      estimatedGrams: {
        type: 'number',
        description: '本次实际摄入的总克重。',
        minimum: 1,
      },
      confidence: {
        type: 'number',
        description: '0 到 1 之间的小数，表示你对名称和克重判断的信心。',
        minimum: 0,
        maximum: 1,
      },
      fallbackPer100g: {
        type: 'object',
        properties: {
          energyKcal: {type: 'number', minimum: 0},
          proteinGrams: {type: 'number', minimum: 0},
          carbohydrateGrams: {type: 'number', minimum: 0},
          fatGrams: {type: 'number', minimum: 0},
        },
        required: [
          'energyKcal',
          'proteinGrams',
          'carbohydrateGrams',
          'fatGrams',
        ],
        additionalProperties: false,
      },
    },
    required: [
      'foodName',
      'quantityDescription',
      'estimatedGrams',
      'confidence',
      'fallbackPer100g',
    ],
    additionalProperties: false,
  },
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
  error?: {
    message?: string;
  };
};

function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }
  return apiKey;
}

function getGeminiApiBaseUrl(): string {
  return (process.env.GEMINI_API_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta').replace(
    /\/$/,
    ''
  );
}

function getGeminiModel(): string {
  return process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview';
}

function extractTextContent(payload: GeminiResponse): string {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => part.text ?? '')
    .join('')
    .trim();

  if (text) {
    return text;
  }

  if (payload.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the request: ${payload.promptFeedback.blockReason}`);
  }

  throw new Error(
    `Gemini returned an empty response${payload.candidates?.[0]?.finishReason ? ` (${payload.candidates[0].finishReason})` : ''}.`
  );
}

function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Gemini returned an empty JSON payload.');
  }

  try {
    return JSON.parse(trimmed);
  } catch {}

  const fencedMatch =
    trimmed.match(/```json\s*([\s\S]*?)```/i) ??
    trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return JSON.parse(fencedMatch[1].trim());
  }

  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1));
  }

  throw new Error('Unable to extract a JSON array from Gemini response.');
}

async function requestGeminiJsonArray(
  prompt: string,
  systemPrompt: string,
  maxOutputTokens: number
): Promise<AiParsedFoodItem[]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${getGeminiApiBaseUrl()}/models/${getGeminiModel()}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': getGeminiApiKey(),
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{text: systemPrompt}],
            },
            contents: [
              {
                role: 'user',
                parts: [{text: prompt}],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens,
              responseMimeType: 'application/json',
              responseJsonSchema: RESPONSE_JSON_SCHEMA,
              thinkingConfig: {
                thinkingLevel: 'low',
              },
            },
          }),
          cache: 'no-store',
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Gemini request failed with ${response.status}: ${errorText.slice(0, 240)}`
        );
      }

      const payload = (await response.json()) as GeminiResponse;
      if (payload.error?.message) {
        throw new Error(payload.error.message);
      }

      const text = extractTextContent(payload);
      const jsonPayload = extractJsonPayload(text);

      return AiParsedFoodItemsSchema.parse(jsonPayload);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof Error && lastError.name === 'AbortError') {
    throw new Error('Gemini request timed out. Please try again in a moment.');
  }

  throw lastError instanceof Error ? lastError : new Error('Gemini request failed.');
}

export async function parseFoodCandidatesWithGemini(
  description: string
): Promise<AiParsedFoodItem[]> {
  return requestGeminiJsonArray(
    `请拆解这句饮食描述，并输出约定的 JSON 数组：\n${description}`,
    SYSTEM_PROMPT,
    2048
  );
}
