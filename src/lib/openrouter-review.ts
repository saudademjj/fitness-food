import {recordAiUsageTelemetry} from '@/lib/ai-usage-telemetry';
import {
  AiReviewedFoodItemsSchema,
  type AiReviewedFoodItem,
} from '@/lib/food-contract';
import {
  buildSecondaryReviewPrompt,
  SECONDARY_REVIEW_SYSTEM_PROMPT,
} from '@/lib/secondary-review-prompt';
import {sanitizeFallbackNutritionProfile} from '@/lib/validation';

const DEFAULT_REQUEST_TIMEOUT_MS = 25_000;
const DEFAULT_MODEL_ID = 'minimax/minimax-m2.7';
const DEFAULT_PROVIDER_ORDER = ['minimax'] as const;
const MAX_ATTEMPTS = 1;
const RETRY_DELAY_MS = 1_200;

type UsageMetadata = {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
};

type OpenRouterChatCompletionResponse = {
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

function readStringEnv(names: string | string[]): string | undefined {
  for (const name of Array.isArray(names) ? names : [names]) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function getOpenRouterApiKey(): string | null {
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

function getOpenRouterBaseUrl(): string {
  return (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(
    /\/$/,
    ''
  );
}

function getOpenRouterTimeoutMs(): number {
  const raw = readStringEnv([
    'OPENROUTER_MINIMAX_REVIEW_TIMEOUT_MS',
    'OPENROUTER_REVIEW_TIMEOUT_MS',
    'PRIMARY_MODEL_REVIEW_REQUEST_TIMEOUT_MS',
  ]);
  if (!raw) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REQUEST_TIMEOUT_MS;
}

function getOpenRouterMinimaxModel(): string {
  return (
    readStringEnv([
      'OPENROUTER_MINIMAX_REVIEW_MODEL',
      'OPENROUTER_MINIMAX_MODEL',
      'SECONDARY_REVIEW_MINIMAX_MODEL',
    ]) ?? DEFAULT_MODEL_ID
  );
}

function getOpenRouterMinimaxProviderOrder(): string[] {
  const configured = readStringEnv([
    'OPENROUTER_MINIMAX_REVIEW_PROVIDER_ORDER',
    'OPENROUTER_MINIMAX_PROVIDER_ORDER',
  ]);

  if (!configured) {
    return [...DEFAULT_PROVIDER_ORDER];
  }

  return configured
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getOpenRouterMinimaxAllowFallbacks(): boolean {
  const raw = readStringEnv([
    'OPENROUTER_MINIMAX_REVIEW_ALLOW_FALLBACKS',
    'OPENROUTER_MINIMAX_ALLOW_FALLBACKS',
  ])?.toLowerCase();

  if (!raw) {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function buildOpenRouterHeaders(): Record<string, string> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  const httpReferer =
    process.env.OPENROUTER_HTTP_REFERER?.trim() || process.env.APP_BASE_URL?.trim();
  const appName = process.env.OPENROUTER_APP_NAME?.trim() || 'fitness-food';

  if (httpReferer) {
    headers['HTTP-Referer'] = httpReferer;
  }
  headers['X-Title'] = appName;

  return headers;
}

function extractTextContent(payload: OpenRouterChatCompletionResponse): string {
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

  throw new Error('OpenRouter returned an empty review response.');
}

function normalizeOpenRouterErrorMessage(status: number, errorText: string): string {
  if (
    status === 404 &&
    errorText.includes('No endpoints available matching your guardrail restrictions and data policy')
  ) {
    return 'OpenRouter MiniMax reviewer is blocked by your privacy settings or provider policy. Check the model route and privacy settings in https://openrouter.ai/settings/privacy .';
  }

  return `OpenRouter MiniMax request failed with ${status}: ${errorText.slice(0, 240)}`;
}

function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('OpenRouter returned an empty JSON payload.');
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

  throw new Error('Unable to extract JSON from OpenRouter response.');
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

export function getOpenRouterMinimaxReviewModel(): {
  provider: 'minimax';
  model: string;
} | null {
  if (!getOpenRouterApiKey()) {
    return null;
  }

  return {
    provider: 'minimax',
    model: getOpenRouterMinimaxModel(),
  };
}

export async function reviewResolvedFoodsWithOpenRouterMinimax(
  sourceDescription: string,
  foods: Parameters<typeof buildSecondaryReviewPrompt>[1],
  weightLocks: boolean[]
): Promise<AiReviewedFoodItem[]> {
  if (!getOpenRouterApiKey()) {
    throw new Error('OPENROUTER_API_KEY is not configured.');
  }

  const model = getOpenRouterMinimaxModel();
  const prompt = buildSecondaryReviewPrompt(sourceDescription, foods, weightLocks);
  const startedAt = Date.now();
  let lastError: unknown;
  let lastUsage: UsageMetadata | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getOpenRouterTimeoutMs());

    try {
      const response = await fetch(`${getOpenRouterBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: buildOpenRouterHeaders(),
        body: JSON.stringify({
          model,
          provider: {
            order: getOpenRouterMinimaxProviderOrder(),
            allow_fallbacks: getOpenRouterMinimaxAllowFallbacks(),
          },
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
        throw new Error(normalizeOpenRouterErrorMessage(response.status, errorText));
      }

      const payload = (await response.json()) as OpenRouterChatCompletionResponse;
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
      ? 'OpenRouter MiniMax request timed out.'
      : lastError instanceof Error
        ? lastError.message
        : 'OpenRouter MiniMax review failed.';

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
    throw new Error('OpenRouter MiniMax request timed out.');
  }

  throw lastError instanceof Error ? lastError : new Error('OpenRouter MiniMax review failed.');
}
