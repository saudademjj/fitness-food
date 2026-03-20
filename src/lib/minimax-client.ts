import {recordAiUsageTelemetry} from '@/lib/ai-usage-telemetry';
import {
  ESTIMATION_SYSTEM_PROMPT,
  ESTIMATION_RESPONSE_JSON_SCHEMA,
  normalizeParsedItemsPayload,
  extractJsonPayload as extractJsonPayloadShared,
} from '@/lib/ai-estimation-prompt';
import {
  AiParsedFoodItemsSchema,
  AiReviewedFoodItemsSchema,
  type AiParsedFoodItem,
  type AiReviewedFoodItem,
} from '@/lib/food-contract';
import {readStringEnv} from '@/lib/env-utils';
import {buildNutritionProfileMeta} from '@/lib/nutrition-profile';
import {
  buildSecondaryReviewPrompt,
  SECONDARY_REVIEW_SYSTEM_PROMPT,
} from '@/lib/secondary-review-prompt';
import {
  sanitizeFallbackNutritionProfile,
  validateMacroNutrients,
} from '@/lib/validation';

const DEFAULT_REQUEST_TIMEOUT_MS = 25_000;
const DEFAULT_MODEL_ID = 'MiniMax-M2.7';
const MAX_ATTEMPTS = 1;
const RETRY_DELAY_MS = 1_200;

type UsageMetadata = {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
};

type MiniMaxChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>
        | null;
    };
  }>;
  error?: {
    message?: string;
  };
  usage?: UsageMetadata;
};

function getMiniMaxApiKey(): string | null {
  return process.env.MINIMAX_API_KEY?.trim() || null;
}

function getMiniMaxBaseUrl(): string {
  return (process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/v1').replace(
    /\/$/,
    ''
  );
}

function getMiniMaxTimeoutMs(): number {
  const raw = readStringEnv([
    'MINIMAX_REVIEW_TIMEOUT_MS',
    'MINIMAX_REQUEST_TIMEOUT_MS',
    'PRIMARY_MODEL_REVIEW_REQUEST_TIMEOUT_MS',
  ]);
  if (!raw) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REQUEST_TIMEOUT_MS;
}

function getMiniMaxParseTimeoutMs(): number {
  const raw = readStringEnv(['MINIMAX_PARSE_TIMEOUT_MS']);
  if (!raw) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REQUEST_TIMEOUT_MS;
}

function getMiniMaxReviewModel(): string {
  return (
    readStringEnv([
      'MINIMAX_REVIEW_MODEL',
      'MINIMAX_MODEL',
      'SECONDARY_REVIEW_MINIMAX_MODEL',
    ]) ?? DEFAULT_MODEL_ID
  );
}

function getMiniMaxParseModel(): string {
  return readStringEnv(['MINIMAX_PARSE_MODEL']) ?? getMiniMaxReviewModel();
}

function buildMiniMaxHeaders(): Record<string, string> {
  const apiKey = getMiniMaxApiKey();
  if (!apiKey) {
    throw new Error('MINIMAX_API_KEY is not configured.');
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

function extractTextContent(payload: MiniMaxChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();
  }

  throw new Error('MiniMax returned an empty response.');
}

function normalizeMiniMaxErrorMessage(status: number, errorText: string): string {
  return `MiniMax request failed with ${status}: ${errorText.slice(0, 240)}`;
}

function extractJsonPayload(text: string): unknown {
  return extractJsonPayloadShared(text, 'MiniMax');
}

function normalizeReviewedItemsPayload(payload: unknown): unknown {
  if (!Array.isArray(payload)) {
    return payload;
  }

  return payload.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return entry;
    }

    const record = entry as Record<string, unknown>;
    return {
      index: record.index,
      foodName: record.foodName,
      estimatedGrams: record.estimatedGrams,
      confidence: record.confidence,
      reason: record.reason,
      reviewedPer100g:
        record.reviewedPer100g ??
        record.per100g ??
        record.reviewed_per_100g ??
        record.reviewed_per100g,
    };
  });
}

function sanitizeReviewedItems(items: AiReviewedFoodItem[]): AiReviewedFoodItem[] {
  return items.map((item) => {
    const sanitized = sanitizeFallbackNutritionProfile(item.foodName, item.reviewedPer100g);
    return {
      ...item,
      confidence: sanitized.issues.length ? Math.min(item.confidence, 0.45) : item.confidence,
      reviewedPer100g: sanitized.profile,
      reason:
        sanitized.issues.length && item.reason === '待人工确认'
          ? '营养值已保守修正'
          : item.reason,
    };
  });
}

function sanitizeParsedItems(items: AiParsedFoodItem[]): AiParsedFoodItem[] {
  return items.map((item) => {
    const issues = validateMacroNutrients(item.fallbackPer100g, 0.12, item.foodName);
    if (!issues.length) {
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

    const sanitized = sanitizeFallbackNutritionProfile(item.foodName, item.fallbackPer100g);
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

export function getMiniMaxReviewerModel(): {
  provider: 'minimax';
  model: string;
} | null {
  if (!getMiniMaxApiKey()) {
    return null;
  }

  return {
    provider: 'minimax',
    model: getMiniMaxReviewModel(),
  };
}

export function isMiniMaxConfigured(): boolean {
  return Boolean(getMiniMaxApiKey());
}

export async function parseFoodCandidatesWithMiniMax(
  description: string
): Promise<AiParsedFoodItem[]> {
  if (!getMiniMaxApiKey()) {
    throw new Error('MINIMAX_API_KEY is not configured.');
  }

  const model = getMiniMaxParseModel();
  const prompt = `请拆解这句饮食描述，并输出约定的 JSON 数组：\n${description}`;
  const startedAt = Date.now();
  let lastError: unknown;
  let lastUsage: UsageMetadata | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getMiniMaxParseTimeoutMs());

    try {
      const response = await fetch(`${getMiniMaxBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: buildMiniMaxHeaders(),
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 2048,
          messages: [
            {
              role: 'system',
              content: ESTIMATION_SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'food_candidates',
              strict: true,
              schema: ESTIMATION_RESPONSE_JSON_SCHEMA,
            },
          },
        }),
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(normalizeMiniMaxErrorMessage(response.status, errorText));
      }

      const payload = (await response.json()) as MiniMaxChatCompletionResponse;
      lastUsage = payload.usage ?? lastUsage;
      if (payload.error?.message) {
        throw new Error(payload.error.message);
      }

      const text = extractTextContent(payload);
      const jsonPayload = normalizeParsedItemsPayload(extractJsonPayload(text));
      const parsed = AiParsedFoodItemsSchema.parse(jsonPayload);
      const sanitized = sanitizeParsedItems(parsed);

      await recordAiUsageTelemetry({
        provider: 'minimax',
        model,
        requestKind: 'parallel_estimate_minimax',
        inputPreview: prompt.slice(0, 220),
        promptTokens: lastUsage?.prompt_tokens ?? null,
        completionTokens: lastUsage?.completion_tokens ?? null,
        totalTokens: lastUsage?.total_tokens ?? null,
        durationMs: Date.now() - startedAt,
        attemptCount: attempt,
        success: true,
      });
      return sanitized;
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

  const errorMessage =
    lastError instanceof Error && lastError.name === 'AbortError'
      ? 'MiniMax parse request timed out.'
      : lastError instanceof Error
        ? lastError.message
        : 'MiniMax parse failed.';

  await recordAiUsageTelemetry({
    provider: 'minimax',
    model,
    requestKind: 'parallel_estimate_minimax',
    inputPreview: prompt.slice(0, 220),
    promptTokens: lastUsage?.prompt_tokens ?? null,
    completionTokens: lastUsage?.completion_tokens ?? null,
    totalTokens: lastUsage?.total_tokens ?? null,
    durationMs: Date.now() - startedAt,
    attemptCount: MAX_ATTEMPTS,
    success: false,
    errorMessage,
  });

  if (lastError instanceof Error && lastError.name === 'AbortError') {
    throw new Error('MiniMax parse request timed out.');
  }

  throw lastError instanceof Error ? lastError : new Error('MiniMax parse failed.');
}

export async function reviewResolvedFoodsWithMiniMax(
  sourceDescription: string,
  foods: Parameters<typeof buildSecondaryReviewPrompt>[1],
  weightLocks: boolean[]
): Promise<AiReviewedFoodItem[]> {
  if (!getMiniMaxApiKey()) {
    throw new Error('MINIMAX_API_KEY is not configured.');
  }

  const model = getMiniMaxReviewModel();
  const prompt = buildSecondaryReviewPrompt(sourceDescription, foods, weightLocks);
  const startedAt = Date.now();
  let lastError: unknown;
  let lastUsage: UsageMetadata | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getMiniMaxTimeoutMs());

    try {
      const response = await fetch(`${getMiniMaxBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: buildMiniMaxHeaders(),
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 2048,
          messages: [
            {
              role: 'system',
              content: SECONDARY_REVIEW_SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(normalizeMiniMaxErrorMessage(response.status, errorText));
      }

      const payload = (await response.json()) as MiniMaxChatCompletionResponse;
      lastUsage = payload.usage ?? lastUsage;
      if (payload.error?.message) {
        throw new Error(payload.error.message);
      }

      const text = extractTextContent(payload);
      const jsonPayload = normalizeReviewedItemsPayload(extractJsonPayload(text));
      const parsed = AiReviewedFoodItemsSchema.parse(jsonPayload);
      const sanitized = sanitizeReviewedItems(parsed);

      await recordAiUsageTelemetry({
        provider: 'minimax',
        model,
        requestKind: 'review_resolved_foods',
        inputPreview: prompt.slice(0, 220),
        promptTokens: lastUsage?.prompt_tokens ?? null,
        completionTokens: lastUsage?.completion_tokens ?? null,
        totalTokens: lastUsage?.total_tokens ?? null,
        durationMs: Date.now() - startedAt,
        attemptCount: attempt,
        success: true,
      });
      return sanitized;
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

  const errorMessage =
    lastError instanceof Error && lastError.name === 'AbortError'
      ? 'MiniMax request timed out.'
      : lastError instanceof Error
        ? lastError.message
        : 'MiniMax review failed.';

  await recordAiUsageTelemetry({
    provider: 'minimax',
    model,
    requestKind: 'review_resolved_foods',
    inputPreview: prompt.slice(0, 220),
    promptTokens: lastUsage?.prompt_tokens ?? null,
    completionTokens: lastUsage?.completion_tokens ?? null,
    totalTokens: lastUsage?.total_tokens ?? null,
    durationMs: Date.now() - startedAt,
    attemptCount: MAX_ATTEMPTS,
    success: false,
    errorMessage,
  });

  if (lastError instanceof Error && lastError.name === 'AbortError') {
    throw new Error('MiniMax request timed out.');
  }

  throw lastError instanceof Error ? lastError : new Error('MiniMax review failed.');
}
