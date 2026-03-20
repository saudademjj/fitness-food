import {recordAiUsageTelemetry} from '@/lib/ai-usage-telemetry';
import {
  ESTIMATION_SYSTEM_PROMPT,
  ESTIMATION_RESPONSE_JSON_SCHEMA,
  COMPOSITE_DISH_SYSTEM_PROMPT,
  COMPOSITE_RESPONSE_JSON_SCHEMA,
  normalizeNutritionProfilePayload,
  normalizeParsedItemsPayload,
  extractJsonPayload as extractJsonPayloadShared,
} from '@/lib/ai-estimation-prompt';
import {
  readBooleanEnv,
  readPositiveIntegerEnv,
  readStringEnv,
} from '@/lib/env-utils';
import {buildNutritionProfileMeta} from '@/lib/nutrition-profile';
import {
  AiCompositeDishBreakdownSchema,
  AiParsedFoodItemsSchema,
  AiReviewedFoodItemsSchema,
  type AiCompositeDishBreakdown,
  type AiParsedFoodItem,
  type AiReviewedFoodItem,
  type NutritionProfile23,
} from '@/lib/food-contract';
import {
  buildSecondaryReviewPrompt,
  SECONDARY_REVIEW_SYSTEM_PROMPT,
} from '@/lib/secondary-review-prompt';
import {
  sanitizeFallbackNutritionProfile,
  validateMacroNutrients,
} from '@/lib/validation';

const DEFAULT_REQUEST_TIMEOUT_MS = 25_000;
const ENHANCED_REQUEST_TIMEOUT_MS = 45_000;
const REVIEW_REQUEST_TIMEOUT_MS = 15_000;
const REVIEW_MAX_OUTPUT_TOKENS = 1_024;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_200;
const NETWORK_SEARCH_HINT_PATTERN =
  /([A-Za-z]{2,}|可口可乐|百事|雪碧|芬达|元气森林|外星人|红牛|瑞幸|星巴克|麦当劳|麦旋风|麦乐鸡|肯德基|汉堡王|必胜客|塔斯汀|喜茶|奈雪|霸王茶姬|蜜雪冰城|古茗|沪上阿姨|茶百道|新品|限定|联名|能量饮料|蛋白棒|即食鸡胸肉)/i;

// SYSTEM_PROMPT, COMPOSITE_DISH_SYSTEM_PROMPT, and JSON schemas are now in ai-estimation-prompt.ts

const FLEXIBLE_REVIEW_RESPONSE_JSON_SCHEMA = {
  type: 'array',
} as const;

type PrimaryModelUsageMetadata = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type PrimaryModelChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
  };
  usage?: PrimaryModelUsageMetadata;
};

type CandidateValidationIssue = {
  index: number;
  foodName: string;
  issues: string[];
};

function getPrimaryModelApiKey(): string {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterApiKey) {
    return openRouterApiKey;
  }

  const apiKey = process.env.DASHSCOPE_API_KEY ?? process.env.BAILIAN_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY or DASHSCOPE_API_KEY is not configured.');
  }
  return apiKey;
}

function getPrimaryModelApiBaseUrl(): string {
  return (
    process.env.OPENROUTER_BASE_URL ??
    process.env.DASHSCOPE_BASE_URL ??
    'https://dashscope.aliyuncs.com/compatible-mode/v1'
  ).replace(/\/$/, '');
}

function getPrimaryModelId(): string {
  const configuredModel = readStringEnv([
    'OPENROUTER_MODEL',
    'PRIMARY_MODEL_ID',
    'DASHSCOPE_MODEL',
  ]);
  if (configuredModel) {
    return configuredModel;
  }

  if (getPrimaryModelProvider() === 'openrouter') {
    return 'xiaomi/mimo-v2-pro';
  }

  throw new Error('PRIMARY_MODEL_ID or OPENROUTER_MODEL is not configured.');
}

function getPrimaryModelProvider(): 'openrouter' | 'dashscope' {
  return process.env.OPENROUTER_API_KEY?.trim() ? 'openrouter' : 'dashscope';
}

function getPrimaryModelDisplayName(): string {
  return '主模型';
}

function buildPrimaryModelHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getPrimaryModelApiKey()}`,
  };

  if (getPrimaryModelProvider() === 'openrouter') {
    const httpReferer = process.env.OPENROUTER_HTTP_REFERER?.trim() || process.env.APP_BASE_URL?.trim();
    const appName = process.env.OPENROUTER_APP_NAME?.trim() || 'fitness-food';

    if (httpReferer) {
      headers['HTTP-Referer'] = httpReferer;
    }

    headers['X-Title'] = appName;
  }

  return headers;
}

function getPrimaryModelSearchStrategy(): 'turbo' | 'max' {
  const raw = readStringEnv('PRIMARY_MODEL_SEARCH_STRATEGY')?.toLowerCase();
  if (raw === 'max') {
    return 'max';
  }

  // Keep the structured JSON path on non-agent search modes and bias to lower latency.
  return 'turbo';
}

function getPrimaryModelRequestTimeoutMs(): number {
  const override = readPositiveIntegerEnv([
    'PRIMARY_MODEL_REQUEST_TIMEOUT_MS',
  ]);
  if (override) {
    return override;
  }

  const enableThinking = readBooleanEnv(
    'PRIMARY_MODEL_ENABLE_THINKING',
    true
  );
  const enableSearch = readBooleanEnv(
    'PRIMARY_MODEL_ENABLE_SEARCH',
    true
  );
  return enableThinking || enableSearch
    ? ENHANCED_REQUEST_TIMEOUT_MS
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

function getPrimaryModelReviewRequestTimeoutMs(): number {
  const override = readPositiveIntegerEnv([
    'PRIMARY_MODEL_REVIEW_REQUEST_TIMEOUT_MS',
  ]);
  if (override) {
    return override;
  }

  return REVIEW_REQUEST_TIMEOUT_MS;
}

function getPrimaryModelReviewMaxAttempts(): number {
  return readPositiveIntegerEnv([
    'PRIMARY_MODEL_REVIEW_MAX_ATTEMPTS',
  ]) ?? 1;
}

function getPrimaryModelReviewMaxOutputTokens(): number {
  return readPositiveIntegerEnv([
    'PRIMARY_MODEL_REVIEW_MAX_TOKENS',
  ]) ?? REVIEW_MAX_OUTPUT_TOKENS;
}

function buildPrimaryModelRequestOptions(allowSearch: boolean) {
  if (getPrimaryModelProvider() === 'openrouter') {
    return {};
  }

  const enableThinking = readBooleanEnv(
    'PRIMARY_MODEL_ENABLE_THINKING',
    true
  );
  const thinkingBudget = enableThinking
    ? readPositiveIntegerEnv('PRIMARY_MODEL_THINKING_BUDGET')
    : undefined;
  const enableSearch = allowSearch && readBooleanEnv(
    'PRIMARY_MODEL_ENABLE_SEARCH',
    true
  );
  const forcedSearch = enableSearch
    ? readBooleanEnv('PRIMARY_MODEL_FORCE_SEARCH', false)
    : false;
  const enableSearchExtension = enableSearch
    ? readBooleanEnv('PRIMARY_MODEL_ENABLE_SEARCH_EXTENSION', false)
    : false;

  return {
    enable_thinking: enableThinking,
    ...(thinkingBudget ? {thinking_budget: thinkingBudget} : {}),
    ...(enableSearch
        ? {
          enable_search: true,
          search_options: {
            forced_search: forcedSearch,
            search_strategy: getPrimaryModelSearchStrategy(),
            enable_search_extension: enableSearchExtension,
          },
        }
      : {}),
  };
}

function getPrimaryModelReviewSearchStrategy(): 'turbo' | 'max' {
  const raw = readStringEnv([
    'PRIMARY_MODEL_REVIEW_SEARCH_STRATEGY',
  ])?.toLowerCase();
  if (raw === 'max') {
    return 'max';
  }

  return 'turbo';
}

function buildPrimaryModelReviewRequestOptions(sourceDescription: string) {
  if (getPrimaryModelProvider() === 'openrouter') {
    return {};
  }

  const enableThinking = readBooleanEnv(
    'PRIMARY_MODEL_REVIEW_ENABLE_THINKING',
    false
  );
  const thinkingBudget = enableThinking
    ? readPositiveIntegerEnv('PRIMARY_MODEL_REVIEW_THINKING_BUDGET')
    : undefined;
  const allowSearch = readBooleanEnv(
    'PRIMARY_MODEL_REVIEW_ENABLE_SEARCH',
    false
  );
  const forcedSearch = allowSearch
    ? readBooleanEnv('PRIMARY_MODEL_REVIEW_FORCE_SEARCH', false)
    : false;
  const enableSearch = allowSearch && (forcedSearch || shouldUseNetworkSearch(sourceDescription));
  const enableSearchExtension = enableSearch
    ? readBooleanEnv('PRIMARY_MODEL_REVIEW_ENABLE_SEARCH_EXTENSION', false)
    : false;

  return {
    enable_thinking: enableThinking,
    ...(thinkingBudget ? {thinking_budget: thinkingBudget} : {}),
    ...(enableSearch
        ? {
          enable_search: true,
          search_options: {
            forced_search: forcedSearch,
            search_strategy: getPrimaryModelReviewSearchStrategy(),
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

function extractTextContent(payload: PrimaryModelChatCompletionResponse): string {
  const text = payload.choices?.[0]?.message?.content?.trim();

  if (text) {
    return text;
  }

  throw new Error(
    `${getPrimaryModelDisplayName()} returned an empty response${payload.choices?.[0]?.finish_reason ? ` (${payload.choices[0].finish_reason})` : ''}.`
  );
}

function extractJsonPayload(text: string): unknown {
  return extractJsonPayloadShared(text, getPrimaryModelDisplayName());
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
      foodName: record.foodName ?? record.name ?? record.food,
      estimatedGrams: record.estimatedGrams ?? record.grams ?? record.weightGrams ?? record.weight,
      confidence: record.confidence,
      reason: record.reason,
      reviewedPer100g: normalizeNutritionProfilePayload(record.reviewedPer100g ?? record.per100g ?? record.reviewed_per_100g ?? record.reviewed_per100g),
    };
  });
}

async function requestPrimaryModelJsonArray(
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
  let lastUsageMetadata: PrimaryModelUsageMetadata | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getPrimaryModelRequestTimeoutMs());

    try {
      const response = await fetch(
        `${getPrimaryModelApiBaseUrl()}/chat/completions`,
        {
          method: 'POST',
          headers: buildPrimaryModelHeaders(),
          body: JSON.stringify({
            model: getPrimaryModelId(),
            temperature: 0,
            max_tokens: maxOutputTokens,
            ...buildPrimaryModelRequestOptions(options?.allowSearch ?? true),
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
              ESTIMATION_RESPONSE_JSON_SCHEMA
            ),
          }),
          cache: 'no-store',
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `${getPrimaryModelDisplayName()} request failed with ${response.status}: ${errorText.slice(0, 240)}`
        );
      }

      const payload = (await response.json()) as PrimaryModelChatCompletionResponse;
      lastUsageMetadata = payload.usage ?? lastUsageMetadata;
      if (payload.error?.message) {
        throw new Error(payload.error.message);
      }

      const text = extractTextContent(payload);
      const jsonPayload = normalizeParsedItemsPayload(extractJsonPayload(text));
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
          provider: getPrimaryModelProvider(),
          model: getPrimaryModelId(),
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
          provider: getPrimaryModelProvider(),
          model: getPrimaryModelId(),
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
      lastError = new Error(
        `Primary model fallbackPer100g validation failed: ${formatValidationIssues(issues)}`
      );
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
      provider: getPrimaryModelProvider(),
      model: getPrimaryModelId(),
      requestKind: 'parse_food_candidates',
      inputPreview: prompt.slice(0, 220),
      promptTokens: lastUsageMetadata?.prompt_tokens ?? null,
      completionTokens: lastUsageMetadata?.completion_tokens ?? null,
      totalTokens: lastUsageMetadata?.total_tokens ?? null,
      durationMs: Date.now() - startedAt,
      attemptCount: MAX_ATTEMPTS,
      success: false,
      errorMessage: `${getPrimaryModelDisplayName()} request timed out.`,
    });
    throw new Error(
      `${getPrimaryModelDisplayName()} request timed out. Please try again in a moment.`
    );
  }

  await recordAiUsageTelemetry({
    provider: getPrimaryModelProvider(),
    model: getPrimaryModelId(),
    requestKind: 'parse_food_candidates',
    inputPreview: prompt.slice(0, 220),
    promptTokens: lastUsageMetadata?.prompt_tokens ?? null,
    completionTokens: lastUsageMetadata?.completion_tokens ?? null,
    totalTokens: lastUsageMetadata?.total_tokens ?? null,
    durationMs: Date.now() - startedAt,
    attemptCount: MAX_ATTEMPTS,
    success: false,
    errorMessage:
      lastError instanceof Error
        ? lastError.message
        : `${getPrimaryModelDisplayName()} request failed.`,
  });
  throw lastError instanceof Error
    ? lastError
    : new Error(`${getPrimaryModelDisplayName()} request failed.`);
}

export async function parseFoodCandidatesWithPrimaryModel(
  description: string
): Promise<AiParsedFoodItem[]> {
  return requestPrimaryModelJsonArray(
    `请拆解这句饮食描述，并输出约定的 JSON 数组：\n${description}`,
    ESTIMATION_SYSTEM_PROMPT,
    2048,
    {
      allowSearch: shouldUseNetworkSearch(description),
    }
  );
}

function validateReviewedItems(items: AiReviewedFoodItem[]): CandidateValidationIssue[] {
  return items
    .map((item, index) => ({
      index,
      foodName: item.foodName,
      issues: validateMacroNutrients(item.reviewedPer100g, 0.12, item.foodName),
    }))
    .filter((item) => item.issues.length > 0);
}

function sanitizeReviewedProfiles(items: AiReviewedFoodItem[]): AiReviewedFoodItem[] {
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

async function requestPrimaryModelReviewJsonArray(
  sourceDescription: string,
  foods: Parameters<typeof buildSecondaryReviewPrompt>[1],
  weightLocks: boolean[]
): Promise<AiReviewedFoodItem[]> {
  const prompt = buildSecondaryReviewPrompt(sourceDescription, foods, weightLocks);
  const startedAt = Date.now();
  const maxAttempts = getPrimaryModelReviewMaxAttempts();
  let lastError: unknown;
  let retryPromptSuffix = '';
  let lastUsageMetadata: PrimaryModelUsageMetadata | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      getPrimaryModelReviewRequestTimeoutMs()
    );

    try {
      const response = await fetch(
        `${getPrimaryModelApiBaseUrl()}/chat/completions`,
        {
          method: 'POST',
          headers: buildPrimaryModelHeaders(),
          body: JSON.stringify({
            model: getPrimaryModelId(),
            temperature: 0,
            max_tokens: getPrimaryModelReviewMaxOutputTokens(),
            ...buildPrimaryModelReviewRequestOptions(sourceDescription),
            messages: [
              {
                role: 'system',
                content: SECONDARY_REVIEW_SYSTEM_PROMPT,
              },
              {
                role: 'user',
                content: `${prompt}${retryPromptSuffix}`,
              },
            ],
            response_format: createJsonSchemaResponseFormat(
              'review_resolved_foods',
              FLEXIBLE_REVIEW_RESPONSE_JSON_SCHEMA
            ),
          }),
          cache: 'no-store',
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `${getPrimaryModelDisplayName()} request failed with ${response.status}: ${errorText.slice(0, 240)}`
        );
      }

      const payload = (await response.json()) as PrimaryModelChatCompletionResponse;
      lastUsageMetadata = payload.usage ?? lastUsageMetadata;
      if (payload.error?.message) {
        throw new Error(payload.error.message);
      }

      const text = extractTextContent(payload);
      const jsonPayload = normalizeReviewedItemsPayload(extractJsonPayload(text));
      const reviewedItems = AiReviewedFoodItemsSchema.parse(jsonPayload);
      const issues = validateReviewedItems(reviewedItems);

      if (!issues.length) {
        const result = sanitizeReviewedProfiles(reviewedItems);
        await recordAiUsageTelemetry({
          provider: getPrimaryModelProvider(),
          model: getPrimaryModelId(),
          requestKind: 'review_resolved_foods',
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

      if (attempt === maxAttempts) {
        const result = sanitizeReviewedProfiles(reviewedItems);
        await recordAiUsageTelemetry({
          provider: getPrimaryModelProvider(),
          model: getPrimaryModelId(),
          requestKind: 'review_resolved_foods',
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

      retryPromptSuffix = `\n\n上一次返回的 reviewedPer100g 不可信，请修正以下问题后重新返回完整 JSON：\n${formatValidationIssues(issues)}`;
      lastError = new Error(
        `Primary model reviewedPer100g validation failed: ${formatValidationIssues(issues)}`
      );
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAY_MS * Math.max(1, 2 ** (attempt - 1)))
      );
      continue;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
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
      provider: getPrimaryModelProvider(),
      model: getPrimaryModelId(),
      requestKind: 'review_resolved_foods',
      inputPreview: prompt.slice(0, 220),
      promptTokens: lastUsageMetadata?.prompt_tokens ?? null,
      completionTokens: lastUsageMetadata?.completion_tokens ?? null,
      totalTokens: lastUsageMetadata?.total_tokens ?? null,
      durationMs: Date.now() - startedAt,
      attemptCount: maxAttempts,
      success: false,
      errorMessage: `${getPrimaryModelDisplayName()} request timed out.`,
    });
    throw new Error(
      `${getPrimaryModelDisplayName()} request timed out. Please try again in a moment.`
    );
  }

  await recordAiUsageTelemetry({
    provider: getPrimaryModelProvider(),
    model: getPrimaryModelId(),
    requestKind: 'review_resolved_foods',
    inputPreview: prompt.slice(0, 220),
    promptTokens: lastUsageMetadata?.prompt_tokens ?? null,
    completionTokens: lastUsageMetadata?.completion_tokens ?? null,
    totalTokens: lastUsageMetadata?.total_tokens ?? null,
    durationMs: Date.now() - startedAt,
    attemptCount: maxAttempts,
    success: false,
    errorMessage:
      lastError instanceof Error
        ? lastError.message
        : `${getPrimaryModelDisplayName()} request failed.`,
  });
  throw lastError instanceof Error
    ? lastError
    : new Error(`${getPrimaryModelDisplayName()} request failed.`);
}

export async function reviewResolvedFoodsWithPrimaryModel(
  sourceDescription: string,
  foods: Parameters<typeof buildSecondaryReviewPrompt>[1],
  weightLocks: boolean[]
): Promise<AiReviewedFoodItem[]> {
  return requestPrimaryModelReviewJsonArray(sourceDescription, foods, weightLocks);
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

async function requestPrimaryModelJsonObject(
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
  let lastUsageMetadata: PrimaryModelUsageMetadata | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getPrimaryModelRequestTimeoutMs());

    try {
      const response = await fetch(
        `${getPrimaryModelApiBaseUrl()}/chat/completions`,
        {
          method: 'POST',
          headers: buildPrimaryModelHeaders(),
          body: JSON.stringify({
            model: getPrimaryModelId(),
            temperature: 0,
            max_tokens: maxOutputTokens,
            ...buildPrimaryModelRequestOptions(options?.allowSearch ?? true),
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
          `${getPrimaryModelDisplayName()} request failed with ${response.status}: ${errorText.slice(0, 240)}`
        );
      }

      const payload = (await response.json()) as PrimaryModelChatCompletionResponse;
      lastUsageMetadata = payload.usage ?? lastUsageMetadata;
      if (payload.error?.message) {
        throw new Error(payload.error.message);
      }

      const text = extractTextContent(payload);
      const jsonPayload = extractJsonPayload(text);
      const parsed = AiCompositeDishBreakdownSchema.parse(jsonPayload);
      const normalized = normalizeCompositeDishBreakdown(parsed);

      await recordAiUsageTelemetry({
        provider: getPrimaryModelProvider(),
        model: getPrimaryModelId(),
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
    provider: getPrimaryModelProvider(),
    model: getPrimaryModelId(),
    requestKind: 'parse_composite_dish',
    inputPreview: prompt.slice(0, 220),
    promptTokens: lastUsageMetadata?.prompt_tokens ?? null,
    completionTokens: lastUsageMetadata?.completion_tokens ?? null,
    totalTokens: lastUsageMetadata?.total_tokens ?? null,
    durationMs: Date.now() - startedAt,
    attemptCount: MAX_ATTEMPTS,
    success: false,
    errorMessage:
      lastError instanceof Error
        ? lastError.message
        : `${getPrimaryModelDisplayName()} request failed.`,
  });
  throw lastError instanceof Error
    ? lastError
    : new Error(`${getPrimaryModelDisplayName()} request failed.`);
}

export async function parseCompositeDishWithPrimaryModel(
  description: string
): Promise<AiCompositeDishBreakdown> {
  return requestPrimaryModelJsonObject(
    `请把这道复合菜拆成原料 JSON 对象：\n${description}`,
    COMPOSITE_DISH_SYSTEM_PROMPT as string,
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
