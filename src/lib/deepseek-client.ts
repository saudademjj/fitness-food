import OpenAI from 'openai';

import {recordAiUsageTelemetry} from '@/lib/ai-usage-telemetry';
import {
  ESTIMATION_SYSTEM_PROMPT,
  normalizeParsedItemsPayload,
  extractJsonPayload as extractJsonPayloadShared,
} from '@/lib/ai-estimation-prompt';
import {
  AiParsedFoodItemsSchema,
  AiReviewedFoodItemsSchema,
  type AiParsedFoodItem,
  type AiReviewedFoodItem,
} from '@/lib/food-contract';
import {buildNutritionProfileMeta} from '@/lib/nutrition-profile';
import {
  buildSecondaryReviewPrompt,
  SECONDARY_REVIEW_SYSTEM_PROMPT,
} from '@/lib/secondary-review-prompt';
import {
  sanitizeFallbackNutritionProfile,
  validateMacroNutrients,
} from '@/lib/validation';

const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_PARSE_TIMEOUT_MS = 25_000;
const MAX_ATTEMPTS = 2;
const PARSE_MAX_ATTEMPTS = 1;
const RETRY_DELAY_MS = 1_200;

type UsageMetadata = {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
};

function getDeepseekApiKey(): string | null {
  return process.env.DEEPSEEK_API_KEY?.trim() || null;
}

function getDeepseekBaseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');
}

function getDeepseekTimeoutMs(): number {
  const raw = process.env.DEEPSEEK_REQUEST_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REQUEST_TIMEOUT_MS;
}

function getDeepseekParseTimeoutMs(): number {
  const raw = process.env.DEEPSEEK_PARSE_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_PARSE_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PARSE_TIMEOUT_MS;
}

function getDeepseekModel(): string | null {
  const configured = process.env.DEEPSEEK_MODEL?.trim();
  return configured ? configured : null;
}

function getDeepseekParseModel(): string {
  const configured = process.env.DEEPSEEK_PARSE_MODEL?.trim();
  return configured || getDeepseekModel() || 'deepseek-chat';
}

function createDeepseekClient(timeoutMs?: number): OpenAI | null {
  const apiKey = getDeepseekApiKey();
  if (!apiKey) {
    return null;
  }

  return new OpenAI({
    apiKey,
    baseURL: getDeepseekBaseUrl(),
    timeout: timeoutMs ?? getDeepseekTimeoutMs(),
  });
}

function extractJsonPayload(text: string): unknown {
  return extractJsonPayloadShared(text, 'DeepSeek');
}

function normalizeDeepseekReviewPayload(payload: unknown): unknown {
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

export function getDeepseekReviewModel(): {provider: 'deepseek'; model: string} | null {
  const model = getDeepseekModel();
  return model ? {provider: 'deepseek', model} : null;
}

export function isDeepSeekConfigured(): boolean {
  return Boolean(getDeepseekApiKey()) && Boolean(getDeepseekModel() || process.env.DEEPSEEK_PARSE_MODEL?.trim());
}

export async function parseFoodCandidatesWithDeepSeek(
  description: string
): Promise<AiParsedFoodItem[]> {
  const client = createDeepseekClient(getDeepseekParseTimeoutMs());
  if (!client) {
    throw new Error('DEEPSEEK_API_KEY is not configured.');
  }

  const model = getDeepseekParseModel();
  const prompt = `请拆解这句饮食描述，并输出约定的 JSON 数组：\n${description}`;
  const startedAt = Date.now();
  let lastError: unknown;
  let lastUsage: UsageMetadata | undefined;

  for (let attempt = 1; attempt <= PARSE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await client.chat.completions.create({
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
      });

      lastUsage = response.usage ?? lastUsage;
      const text = response.choices[0]?.message?.content?.trim();
      if (!text) {
        throw new Error('DeepSeek returned an empty parse response.');
      }

      const jsonPayload = normalizeParsedItemsPayload(extractJsonPayload(text));
      const parsed = AiParsedFoodItemsSchema.parse(jsonPayload);
      const sanitized = sanitizeParsedItems(parsed);

      await recordAiUsageTelemetry({
        provider: 'deepseek',
        model,
        requestKind: 'parallel_estimate_deepseek',
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
      if (attempt === PARSE_MAX_ATTEMPTS) {
        break;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAY_MS * Math.max(1, 2 ** (attempt - 1)))
      );
    }
  }

  await recordAiUsageTelemetry({
    provider: 'deepseek',
    model,
    requestKind: 'parallel_estimate_deepseek',
    inputPreview: prompt.slice(0, 220),
    promptTokens: lastUsage?.prompt_tokens ?? null,
    completionTokens: lastUsage?.completion_tokens ?? null,
    totalTokens: lastUsage?.total_tokens ?? null,
    durationMs: Date.now() - startedAt,
    attemptCount: PARSE_MAX_ATTEMPTS,
    success: false,
    errorMessage: lastError instanceof Error ? lastError.message : 'DeepSeek parse failed.',
  });
  throw lastError instanceof Error ? lastError : new Error('DeepSeek parse failed.');
}

export async function reviewResolvedFoodsWithDeepseek(
  sourceDescription: string,
  foods: Parameters<typeof buildSecondaryReviewPrompt>[1],
  weightLocks: boolean[]
): Promise<AiReviewedFoodItem[]> {
  const client = createDeepseekClient();
  if (!client) {
    throw new Error('DEEPSEEK_API_KEY is not configured.');
  }

  const model = getDeepseekModel();
  if (!model) {
    throw new Error('DEEPSEEK_MODEL is not configured.');
  }

  const prompt = buildSecondaryReviewPrompt(sourceDescription, foods, weightLocks);
  const startedAt = Date.now();
  let lastError: unknown;
  let lastUsage: UsageMetadata | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await client.chat.completions.create({
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
      });

      lastUsage = response.usage ?? lastUsage;
      const text = response.choices[0]?.message?.content?.trim();
      if (!text) {
        throw new Error('deepseek returned an empty review response.');
      }

      const jsonPayload = normalizeDeepseekReviewPayload(extractJsonPayload(text));
      const parsed = AiReviewedFoodItemsSchema.parse(jsonPayload);
      const sanitized = sanitizeReviewedItems(parsed);

      await recordAiUsageTelemetry({
        provider: 'deepseek',
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
    }
  }

  await recordAiUsageTelemetry({
    provider: 'deepseek',
    model,
    requestKind: 'review_resolved_foods',
    inputPreview: prompt.slice(0, 220),
    promptTokens: lastUsage?.prompt_tokens ?? null,
    completionTokens: lastUsage?.completion_tokens ?? null,
    totalTokens: lastUsage?.total_tokens ?? null,
    durationMs: Date.now() - startedAt,
    attemptCount: MAX_ATTEMPTS,
    success: false,
    errorMessage: lastError instanceof Error ? lastError.message : 'deepseek review failed.',
  });
  throw lastError instanceof Error ? lastError : new Error('deepseek review failed.');
}
