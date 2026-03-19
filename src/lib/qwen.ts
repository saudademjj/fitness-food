import {recordAiUsageTelemetry} from '@/lib/ai-usage-telemetry';
import {buildNutritionProfileMeta} from '@/lib/nutrition-profile';
import {
  AiCompositeDishBreakdownSchema,
  AiParsedFoodItemsSchema,
  type AiCompositeDishBreakdown,
  type AiParsedFoodItem,
} from '@/lib/food-contract';
import {
  sanitizeFallbackNutritionProfile,
  validateMacroNutrients,
} from '@/lib/validation';

const DEFAULT_REQUEST_TIMEOUT_MS = 25_000;
const ENHANCED_REQUEST_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_200;
const NETWORK_SEARCH_HINT_PATTERN =
  /([A-Za-z]{2,}|可口可乐|百事|雪碧|芬达|元气森林|外星人|红牛|瑞幸|星巴克|麦当劳|麦旋风|麦乐鸡|肯德基|汉堡王|必胜客|塔斯汀|喜茶|奈雪|霸王茶姬|蜜雪冰城|古茗|沪上阿姨|茶百道|新品|限定|联名|能量饮料|蛋白棒|即食鸡胸肉)/i;

const SYSTEM_PROMPT = `
你是中文饮食记录助手。
只在本地营养数据库无法直接命中整句描述时，帮后端把用户的一句话饮食描述拆成最终可查库的食物条目。

目标：
1. 尽量输出容易命中数据库的通用中文食物名或菜名。
2. 单一食品、品牌食品、完整成品如果本身就是独立食物，例如"麦旋风""可乐""纯牛奶""肉包子"，可直接作为一个条目返回。
3. 如果用户描述的是一道完整的菜（例如"辣椒炒肉"、"番茄炒蛋"、"宫保鸡丁"、"红烧排骨"、"清蒸鲈鱼"、"麻婆豆腐"），作为单个条目返回这道菜的整体名称，不要拆解成原料。
4. 只有当描述涉及多种独立食物的组合餐、套餐、便当时（例如"一碗米饭加一个鸡腿和一碗汤"），才拆解成各自独立的条目。
5. 估算每个条目这次实际吃下的总克重。
6. 额外给出每100g 的 23 项营养兜底字段，但只有宏量营养必须给出；微量营养没有把握时必须返回 null，不能猜。

要求：
- 只返回 JSON 数组，不要解释，不要 Markdown。
- estimatedGrams 必须是每个条目这次总摄入重量，不是单个重量。
- quantityDescription 保留关键量词；没有明确数量时写“未知”。
- 看到“一个 / 一碗 / 一杯 / 一份 / 一盘 / 一片”时，estimatedGrams 必须参考常见成品份量：
  一个鸡蛋约 50g；一碗熟米饭约 180g；一杯豆浆约 300g；一份炒饭/盖饭约 300-400g；
  一碗汤面约 350-500g；一片披萨约 100-150g；一份蛋糕约 80-120g。
- 没有明确重量依据时，不要把“一碗面”估成 200g 或 500g 这种极端值；拿不准就给中间常见值，并降低 confidence。
- fallbackPer100g 必须包含以下 23 项字段：
  energyKcal、proteinGrams、carbohydrateGrams、fatGrams、
  fiberGrams、sugarsGrams、
  sodiumMg、potassiumMg、calciumMg、magnesiumMg、ironMg、zincMg、
  vitaminAMcg、vitaminCMg、vitaminDMcg、vitaminEMg、vitaminKMcg、
  thiaminMg、riboflavinMg、niacinMg、vitaminB6Mg、vitaminB12Mcg、folateMcg。
- 对 19 项微量营养素没有把握时，直接返回 null；不要为了凑字段而猜值。
- 对植物性蔬菜、水果、米饭、面、面包等食物，vitaminB12 和 vitaminD 没有可靠证据时返回 null，不要给出显著数值。
- 一句话里提到多种独立食物时才拆成多个元素，例如"两个包子和一杯豆浆"拆为包子和豆浆两个条目。
- 单道菜名如"辣椒炒肉"、"番茄烧牛腩"、"鱼香肉丝"直接作为一个完整条目返回，不要拆解成原料。
- 像"火腿蛋炒饭"这类食物名，直接作为一个条目"火腿蛋炒饭"返回即可，不要拆成米饭+鸡蛋+火腿。
- 如果用户提供了总克重，例如"400g火腿蛋炒饭"，直接使用该克重，不需要拆解。
- 对品牌名、口语化描述做适度归一，例如"小肉包"可归一为"鲜肉包子"。
- 对品牌食品、包装食品、连锁餐饮、新品或季节限定口味，如有必要可联网核对净含量、规格、份量或公开营养信息。
- 联网结果若互相矛盾，优先采用更保守、更常见的份量；没有可靠信息时不要编造，直接降低 confidence。
`;

const COMPOSITE_DISH_SYSTEM_PROMPT = `
你是中文饮食记录助手，当前任务是把单道复合菜拆成可查库原料。

目标：
1. 输入一定是一道单独的成品菜或复合主食，例如“辣椒炒肉”“番茄炒蛋”“宫保鸡丁”“火腿蛋炒饭”。
2. 输出最常见、最容易命中营养数据库的原料名，不要输出调味步骤、品牌名或口语化废话。
3. 给出每个原料在这道菜中的实际克重，所有原料 estimatedGrams 之和必须接近整道菜总重量。
4. 对影响热量或钠含量明显的原料，要包含食用油、盐、酱油等基础调味项。
5. 每个原料只返回宏量营养兜底：energyKcal、proteinGrams、carbohydrateGrams、fatGrams。
6. dishName 必须是原菜名或更标准的同义菜名；totalEstimatedGrams 必须是整道菜总重量。

要求：
- 只返回 JSON 对象，不要解释，不要 Markdown。
- ingredients 里的 ingredientName 必须是单个原料，不要再写“辣椒炒肉”这种整菜。
- estimatedGrams 必须是该原料在这道菜里的总克重，不是每100g。
- confidence 用 0 到 1 表示你对该原料名和克重的把握。
- fallbackPer100g 只包含宏量营养 4 项；拿不准时给保守中位值，不要输出极端值。
- 如果用户给了明确总重量，例如“400g辣椒炒肉”，totalEstimatedGrams 应尽量贴近该重量，ingredients 总克重也要贴近。
- 如果是炒菜，通常会包含少量油；如果是带汁菜，可以包含少量盐或酱油；但不要无意义地堆很多调料。
- 对连锁餐饮或明显带品牌的成品菜，必要时可联网参考公开配料、份量或营养信息，但不要直接照搬营销文案。
`;

const NULLABLE_NON_NEGATIVE_SCHEMA = {
  anyOf: [
    {type: 'number', minimum: 0},
    {type: 'null'},
  ],
} as const;

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
          energyKcal: NULLABLE_NON_NEGATIVE_SCHEMA,
          proteinGrams: NULLABLE_NON_NEGATIVE_SCHEMA,
          carbohydrateGrams: NULLABLE_NON_NEGATIVE_SCHEMA,
          fatGrams: NULLABLE_NON_NEGATIVE_SCHEMA,
          fiberGrams: NULLABLE_NON_NEGATIVE_SCHEMA,
          sugarsGrams: NULLABLE_NON_NEGATIVE_SCHEMA,
          sodiumMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          potassiumMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          calciumMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          magnesiumMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          ironMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          zincMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          vitaminAMcg: NULLABLE_NON_NEGATIVE_SCHEMA,
          vitaminCMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          vitaminDMcg: NULLABLE_NON_NEGATIVE_SCHEMA,
          vitaminEMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          vitaminKMcg: NULLABLE_NON_NEGATIVE_SCHEMA,
          thiaminMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          riboflavinMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          niacinMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          vitaminB6Mg: NULLABLE_NON_NEGATIVE_SCHEMA,
          vitaminB12Mcg: NULLABLE_NON_NEGATIVE_SCHEMA,
          folateMcg: NULLABLE_NON_NEGATIVE_SCHEMA,
        },
        required: [
          'energyKcal',
          'proteinGrams',
          'carbohydrateGrams',
          'fatGrams',
          'fiberGrams',
          'sugarsGrams',
          'sodiumMg',
          'potassiumMg',
          'calciumMg',
          'magnesiumMg',
          'ironMg',
          'zincMg',
          'vitaminAMcg',
          'vitaminCMg',
          'vitaminDMcg',
          'vitaminEMg',
          'vitaminKMcg',
          'thiaminMg',
          'riboflavinMg',
          'niacinMg',
          'vitaminB6Mg',
          'vitaminB12Mcg',
          'folateMcg',
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

const COMPOSITE_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    dishName: {
      type: 'string',
    },
    totalEstimatedGrams: {
      type: 'number',
      minimum: 1,
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    cookingMethod: {
      anyOf: [{type: 'string'}, {type: 'null'}],
    },
    ingredients: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          ingredientName: {
            type: 'string',
          },
          estimatedGrams: {
            type: 'number',
            minimum: 1,
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
          },
          optional: {
            type: 'boolean',
          },
          fallbackPer100g: {
            type: 'object',
            properties: {
              energyKcal: NULLABLE_NON_NEGATIVE_SCHEMA,
              proteinGrams: NULLABLE_NON_NEGATIVE_SCHEMA,
              carbohydrateGrams: NULLABLE_NON_NEGATIVE_SCHEMA,
              fatGrams: NULLABLE_NON_NEGATIVE_SCHEMA,
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
          'ingredientName',
          'estimatedGrams',
          'confidence',
          'optional',
          'fallbackPer100g',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['dishName', 'totalEstimatedGrams', 'confidence', 'ingredients'],
  additionalProperties: false,
};

type QwenUsageMetadata = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type QwenChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
  };
  usage?: QwenUsageMetadata;
};

type CandidateValidationIssue = {
  index: number;
  foodName: string;
  issues: string[];
};

function getDashScopeApiKey(): string {
  const apiKey = process.env.DASHSCOPE_API_KEY ?? process.env.BAILIAN_API_KEY;
  if (!apiKey) {
    throw new Error('DASHSCOPE_API_KEY is not configured.');
  }
  return apiKey;
}

function getDashScopeApiBaseUrl(): string {
  return (
    process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  ).replace(/\/$/, '');
}

function getQwenModel(): string {
  return process.env.QWEN_MODEL ?? 'qwen3.5-plus';
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on'].includes(raw)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(raw)) {
    return false;
  }

  return fallback;
}

function readPositiveIntegerEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getQwenSearchStrategy(): 'turbo' | 'max' {
  const raw = process.env.QWEN_SEARCH_STRATEGY?.trim().toLowerCase();
  if (raw === 'max') {
    return 'max';
  }

  // Keep the structured JSON path on non-agent search modes and bias to lower latency.
  return 'turbo';
}

function getQwenRequestTimeoutMs(): number {
  const override = readPositiveIntegerEnv('QWEN_REQUEST_TIMEOUT_MS');
  if (override) {
    return override;
  }

  const enableThinking = readBooleanEnv('QWEN_ENABLE_THINKING', true);
  const enableSearch = readBooleanEnv('QWEN_ENABLE_SEARCH', true);
  return enableThinking || enableSearch
    ? ENHANCED_REQUEST_TIMEOUT_MS
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

function buildQwenRequestOptions(allowSearch: boolean) {
  const enableThinking = readBooleanEnv('QWEN_ENABLE_THINKING', true);
  const thinkingBudget = enableThinking
    ? readPositiveIntegerEnv('QWEN_THINKING_BUDGET')
    : undefined;
  const enableSearch = allowSearch && readBooleanEnv('QWEN_ENABLE_SEARCH', true);
  const forcedSearch = enableSearch
    ? readBooleanEnv('QWEN_FORCE_SEARCH', false)
    : false;
  const enableSearchExtension = enableSearch
    ? readBooleanEnv('QWEN_ENABLE_SEARCH_EXTENSION', false)
    : false;

  return {
    enable_thinking: enableThinking,
    ...(thinkingBudget ? {thinking_budget: thinkingBudget} : {}),
    ...(enableSearch
      ? {
          enable_search: true,
          search_options: {
            forced_search: forcedSearch,
            search_strategy: getQwenSearchStrategy(),
            enable_search_extension: enableSearchExtension,
          },
        }
      : {}),
  };
}

function shouldUseNetworkSearch(description: string): boolean {
  return NETWORK_SEARCH_HINT_PATTERN.test(description);
}

function createJsonSchemaResponseFormat(name: string, schema: object) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name,
      strict: true,
      schema,
    },
  };
}

function extractTextContent(payload: QwenChatCompletionResponse): string {
  const text = payload.choices?.[0]?.message?.content?.trim();

  if (text) {
    return text;
  }

  throw new Error(
    `Qwen returned an empty response${payload.choices?.[0]?.finish_reason ? ` (${payload.choices[0].finish_reason})` : ''}.`
  );
}

function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Qwen returned an empty JSON payload.');
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

  throw new Error('Unable to extract JSON from Qwen response.');
}

async function requestQwenJsonArray(
  prompt: string,
  systemPrompt: string,
  maxOutputTokens: number,
  options?: {
    allowSearch?: boolean;
  }
): Promise<AiParsedFoodItem[]> {
  const startedAt = Date.now();
  let lastError: unknown;
  let retryPromptSuffix = '';
  let lastUsageMetadata: QwenUsageMetadata | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getQwenRequestTimeoutMs());

    try {
      const response = await fetch(
        `${getDashScopeApiBaseUrl()}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getDashScopeApiKey()}`,
          },
          body: JSON.stringify({
            model: getQwenModel(),
            temperature: 0,
            max_tokens: maxOutputTokens,
            ...buildQwenRequestOptions(options?.allowSearch ?? true),
            messages: [
              {
                role: 'system',
                content: systemPrompt,
              },
              {
                role: 'user',
                content: `${prompt}${retryPromptSuffix}`,
              },
            ],
            response_format: createJsonSchemaResponseFormat(
              'food_candidates',
              RESPONSE_JSON_SCHEMA
            ),
          }),
          cache: 'no-store',
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Qwen request failed with ${response.status}: ${errorText.slice(0, 240)}`
        );
      }

      const payload = (await response.json()) as QwenChatCompletionResponse;
      lastUsageMetadata = payload.usage ?? lastUsageMetadata;
      if (payload.error?.message) {
        throw new Error(payload.error.message);
      }

      const text = extractTextContent(payload);
      const jsonPayload = extractJsonPayload(text);
      const parsedItems = AiParsedFoodItemsSchema.parse(jsonPayload);
      const issues = validateParsedItems(parsedItems);
      if (!issues.length) {
        const result = parsedItems.map((item) => ({
          ...item,
          fallbackPer100gMeta: buildNutritionProfileMeta(item.fallbackPer100g, {
            knownStatus: 'estimated',
            knownSource: 'ai',
            missingSource: 'ai',
          }),
          fallbackAdjusted: false,
          fallbackValidationIssues: [],
        }));
        await recordAiUsageTelemetry({
          provider: 'qwen',
          model: getQwenModel(),
          requestKind: 'parse_food_candidates',
          inputPreview: prompt.slice(0, 220),
          promptTokens: lastUsageMetadata?.prompt_tokens ?? null,
          completionTokens: lastUsageMetadata?.completion_tokens ?? null,
          totalTokens: lastUsageMetadata?.total_tokens ?? null,
          durationMs: Date.now() - startedAt,
          attemptCount: attempt,
          success: true,
        });
        return result;
      }

      if (attempt === MAX_ATTEMPTS) {
        const result = sanitizeInvalidFallbackProfiles(parsedItems);
        await recordAiUsageTelemetry({
          provider: 'qwen',
          model: getQwenModel(),
          requestKind: 'parse_food_candidates',
          inputPreview: prompt.slice(0, 220),
          promptTokens: lastUsageMetadata?.prompt_tokens ?? null,
          completionTokens: lastUsageMetadata?.completion_tokens ?? null,
          totalTokens: lastUsageMetadata?.total_tokens ?? null,
          durationMs: Date.now() - startedAt,
          attemptCount: attempt,
          success: true,
        });
        return result;
      }

      retryPromptSuffix = `\n\n上一次返回的 fallbackPer100g 不可信，请修正以下问题后重新返回完整 JSON：\n${formatValidationIssues(issues)}`;
      lastError = new Error(`Qwen fallbackPer100g validation failed: ${formatValidationIssues(issues)}`);
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAY_MS * Math.max(1, 2 ** (attempt - 1)))
      );
      continue;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) {
        break;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAY_MS * Math.max(1, 2 ** (attempt - 1)))
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof Error && lastError.name === 'AbortError') {
    await recordAiUsageTelemetry({
      provider: 'qwen',
      model: getQwenModel(),
      requestKind: 'parse_food_candidates',
      inputPreview: prompt.slice(0, 220),
      promptTokens: lastUsageMetadata?.prompt_tokens ?? null,
      completionTokens: lastUsageMetadata?.completion_tokens ?? null,
      totalTokens: lastUsageMetadata?.total_tokens ?? null,
      durationMs: Date.now() - startedAt,
      attemptCount: MAX_ATTEMPTS,
      success: false,
      errorMessage: 'Qwen request timed out.',
    });
    throw new Error('Qwen request timed out. Please try again in a moment.');
  }

  await recordAiUsageTelemetry({
    provider: 'qwen',
    model: getQwenModel(),
    requestKind: 'parse_food_candidates',
    inputPreview: prompt.slice(0, 220),
    promptTokens: lastUsageMetadata?.prompt_tokens ?? null,
    completionTokens: lastUsageMetadata?.completion_tokens ?? null,
    totalTokens: lastUsageMetadata?.total_tokens ?? null,
    durationMs: Date.now() - startedAt,
    attemptCount: MAX_ATTEMPTS,
    success: false,
    errorMessage: lastError instanceof Error ? lastError.message : 'Qwen request failed.',
  });
  throw lastError instanceof Error ? lastError : new Error('Qwen request failed.');
}

export async function parseFoodCandidatesWithQwen(
  description: string
): Promise<AiParsedFoodItem[]> {
  return requestQwenJsonArray(
    `请拆解这句饮食描述，并输出约定的 JSON 数组：\n${description}`,
    SYSTEM_PROMPT,
    2048,
    {
      allowSearch: shouldUseNetworkSearch(description),
    }
  );
}

function normalizeCompositeDishBreakdown(
  breakdown: AiCompositeDishBreakdown
): AiCompositeDishBreakdown {
  const totalIngredientWeight = breakdown.ingredients.reduce(
    (sum, ingredient) => sum + ingredient.estimatedGrams,
    0
  );
  const targetWeight =
    breakdown.totalEstimatedGrams > 0
      ? breakdown.totalEstimatedGrams
      : totalIngredientWeight;

  if (!totalIngredientWeight || Math.abs(totalIngredientWeight - targetWeight) <= 5) {
    return breakdown;
  }

  return {
    ...breakdown,
    totalEstimatedGrams: targetWeight,
    ingredients: breakdown.ingredients.map((ingredient, index) => {
      const scaledValue = (ingredient.estimatedGrams / totalIngredientWeight) * targetWeight;
      const estimatedGrams =
        index === breakdown.ingredients.length - 1
          ? Math.max(
              1,
              Math.round(
                targetWeight -
                  breakdown.ingredients
                    .slice(0, -1)
                    .reduce(
                      (sum, currentIngredient) =>
                        sum +
                        Math.max(
                          1,
                          Math.round(
                            (currentIngredient.estimatedGrams / totalIngredientWeight) *
                              targetWeight
                          )
                        ),
                      0
                    )
              )
            )
          : Math.max(1, Math.round(scaledValue));

      return {
        ...ingredient,
        estimatedGrams,
      };
    }),
  };
}

async function requestQwenJsonObject(
  prompt: string,
  systemPrompt: string,
  responseJsonSchema: object,
  maxOutputTokens: number,
  options?: {
    allowSearch?: boolean;
  }
): Promise<AiCompositeDishBreakdown> {
  const startedAt = Date.now();
  let lastError: unknown;
  let lastUsageMetadata: QwenUsageMetadata | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getQwenRequestTimeoutMs());

    try {
      const response = await fetch(
        `${getDashScopeApiBaseUrl()}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getDashScopeApiKey()}`,
          },
          body: JSON.stringify({
            model: getQwenModel(),
            temperature: 0,
            max_tokens: maxOutputTokens,
            ...buildQwenRequestOptions(options?.allowSearch ?? true),
            messages: [
              {
                role: 'system',
                content: systemPrompt,
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            response_format: createJsonSchemaResponseFormat(
              'composite_dish_breakdown',
              responseJsonSchema
            ),
          }),
          cache: 'no-store',
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Qwen request failed with ${response.status}: ${errorText.slice(0, 240)}`
        );
      }

      const payload = (await response.json()) as QwenChatCompletionResponse;
      lastUsageMetadata = payload.usage ?? lastUsageMetadata;
      if (payload.error?.message) {
        throw new Error(payload.error.message);
      }

      const text = extractTextContent(payload);
      const jsonPayload = extractJsonPayload(text);
      const parsed = AiCompositeDishBreakdownSchema.parse(jsonPayload);
      const normalized = normalizeCompositeDishBreakdown(parsed);

      await recordAiUsageTelemetry({
        provider: 'qwen',
        model: getQwenModel(),
        requestKind: 'parse_composite_dish',
        inputPreview: prompt.slice(0, 220),
        promptTokens: lastUsageMetadata?.prompt_tokens ?? null,
        completionTokens: lastUsageMetadata?.completion_tokens ?? null,
        totalTokens: lastUsageMetadata?.total_tokens ?? null,
        durationMs: Date.now() - startedAt,
        attemptCount: attempt,
        success: true,
      });
      return normalized;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) {
        break;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAY_MS * Math.max(1, 2 ** (attempt - 1)))
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  await recordAiUsageTelemetry({
    provider: 'qwen',
    model: getQwenModel(),
    requestKind: 'parse_composite_dish',
    inputPreview: prompt.slice(0, 220),
    promptTokens: lastUsageMetadata?.prompt_tokens ?? null,
    completionTokens: lastUsageMetadata?.completion_tokens ?? null,
    totalTokens: lastUsageMetadata?.total_tokens ?? null,
    durationMs: Date.now() - startedAt,
    attemptCount: MAX_ATTEMPTS,
    success: false,
    errorMessage: lastError instanceof Error ? lastError.message : 'Qwen request failed.',
  });
  throw lastError instanceof Error ? lastError : new Error('Qwen request failed.');
}

export async function parseCompositeDishWithQwen(
  description: string
): Promise<AiCompositeDishBreakdown> {
  return requestQwenJsonObject(
    `请把这道复合菜拆成原料 JSON 对象：\n${description}`,
    COMPOSITE_DISH_SYSTEM_PROMPT,
    COMPOSITE_RESPONSE_JSON_SCHEMA,
    2048,
    {
      allowSearch: shouldUseNetworkSearch(description),
    }
  );
}

function validateParsedItems(items: AiParsedFoodItem[]): CandidateValidationIssue[] {
  return items
    .map((item, index) => ({
      index,
      foodName: item.foodName,
      issues: validateMacroNutrients(item.fallbackPer100g, 0.12, item.foodName),
    }))
    .filter((item) => item.issues.length > 0);
}

function formatValidationIssues(issues: CandidateValidationIssue[]): string {
  return issues
    .map((issue) => `${issue.index + 1}. ${issue.foodName}: ${issue.issues.join(', ')}`)
    .join('\n');
}

function sanitizeInvalidFallbackProfiles(items: AiParsedFoodItem[]): AiParsedFoodItem[] {
  return items.map((item) => {
    const sanitized = sanitizeFallbackNutritionProfile(item.foodName, item.fallbackPer100g);
    if (!sanitized.issues.length) {
      return {
        ...item,
        fallbackPer100gMeta: buildNutritionProfileMeta(item.fallbackPer100g, {
          knownStatus: 'estimated',
          knownSource: 'ai',
          missingSource: 'ai',
        }),
        fallbackAdjusted: false,
        fallbackValidationIssues: [],
      };
    }

    return {
      ...item,
      confidence: Math.min(item.confidence, 0.45),
      fallbackPer100g: sanitized.profile,
      fallbackPer100gMeta: buildNutritionProfileMeta(sanitized.profile, {
        knownStatus: 'estimated',
        knownSource: 'ai',
        missingSource: 'ai',
      }),
      fallbackAdjusted: sanitized.adjusted,
      fallbackValidationIssues: sanitized.remainingIssues,
    };
  });
}
