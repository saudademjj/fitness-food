import {
  ParseFoodDescriptionOutputSchema,
  type AiReviewedFoodItem,
  type FoodReviewMeta,
  type ParseFoodDescriptionOutput,
  type ParseFoodDescriptionSegment,
  type ReviewerVote,
  type ResolvedFoodItem,
  type ResolvedFoodItems,
  type SecondaryReviewSummary as SecondaryReviewSummaryContract,
} from '@/lib/food-contract';
import {normalizeLookupText, parseQuantity, sanitizeFoodName} from '@/lib/food-text';
import {
  aggregateNutritionProfiles,
  buildNutritionProfileMeta,
  cloneNutritionProfileMeta,
  createNutritionProfile,
  scaleNutritionProfile,
  NUTRITION_PROFILE_KEYS,
  type NutritionProfile23,
  type NutritionProfileMeta23,
} from '@/lib/nutrition-profile';
import {
  getDeepseekReviewModel,
  reviewResolvedFoodsWithDeepseek,
} from '@/lib/deepseek';
import {
  getOpenRouterMinimaxReviewModel,
  reviewResolvedFoodsWithOpenRouterMinimax,
} from '@/lib/openrouter-review';
import {reviewResolvedFoodsWithPrimaryModel} from '@/lib/primary-model';
import {recordRuntimeError} from '@/lib/runtime-observability';
import {dedupeValidationFlags} from '@/lib/validation';

type SecondaryReviewer = {
  provider: string;
  serialGroup?: string;
  review: (
    sourceDescription: string,
    foods: ResolvedFoodItems,
    weightLocks: boolean[]
  ) => Promise<AiReviewedFoodItem[]>;
};

type ReviewerCooldownState = {
  disabledUntil: number;
  reasonKind: 'rate_limit' | 'timeout' | 'transient';
};

declare global {
  // eslint-disable-next-line no-var
  var __fitnessFoodReviewerCooldowns:
    | Map<string, ReviewerCooldownState>
    | undefined;
}

export type SecondaryReviewSummary = SecondaryReviewSummaryContract;

const OPTIONAL_REVIEWER_COOLDOWN_MS = 10 * 60 * 1000;
const MIN_SUCCESSFUL_REVIEWERS_FOR_CONSENSUS = 2;
const REVIEW_CONSENSUS_SUPPORT_THRESHOLD = 0.68;
const CORE_REVIEW_KEYS = [
  'energyKcal',
  'proteinGrams',
  'carbohydrateGrams',
  'fatGrams',
] as const;

function readBooleanEnv(names: string | string[], fallback = false): boolean {
  for (const name of Array.isArray(names) ? names : [names]) {
    const raw = process.env[name]?.trim().toLowerCase();
    if (!raw) {
      continue;
    }

    if (['1', 'true', 'yes', 'on'].includes(raw)) {
      return true;
    }

    if (['0', 'false', 'no', 'off'].includes(raw)) {
      return false;
    }
  }

  return fallback;
}

function readPositiveIntegerEnv(
  names: string | string[],
  fallback: number
): number {
  for (const name of Array.isArray(names) ? names : [names]) {
    const raw = process.env[name]?.trim();
    if (!raw) {
      continue;
    }

    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallback;
}

function isOptionalReviewerEnabled(
  kind: 'openrouter_minimax' | 'deepseek'
): boolean {
  if (kind === 'openrouter_minimax') {
    return readBooleanEnv(
      [
        'SECONDARY_REVIEW_ENABLE_OPENROUTER_MINIMAX',
        'SECONDARY_REVIEW_ENABLE_MINIMAX_REVIEWER',
        'SECONDARY_REVIEW_ENABLE_SCNET',
        'SCNET_ENABLE_SECONDARY_REVIEW',
      ],
      true
    );
  }

  return readBooleanEnv(
    ['SECONDARY_REVIEW_ENABLE_DEEPSEEK', 'DEEPSEEK_ENABLE_SECONDARY_REVIEW'],
    true
  );
}

function getOptionalReviewerCooldownMs(): number {
  return readPositiveIntegerEnv(
    [
      'SECONDARY_REVIEW_PROVIDER_COOLDOWN_MS',
      'SECONDARY_REVIEW_FAILURE_COOLDOWN_MS',
    ],
    OPTIONAL_REVIEWER_COOLDOWN_MS
  );
}

function roundToSingleDecimal(value: number): number {
  return Number(value.toFixed(1));
}

function roundToTwoDecimals(value: number): number {
  return Number(value.toFixed(2));
}

function calculateOverallConfidence(items: ResolvedFoodItems): number {
  const totalWeight = items.reduce((sum, item) => sum + item.estimatedGrams, 0);
  if (!totalWeight) {
    return 0;
  }

  const weightedConfidence = items.reduce(
    (sum, item) => sum + item.confidence * item.estimatedGrams,
    0
  );
  return roundToTwoDecimals(weightedConfidence / totalWeight);
}

function sumWeight(items: ResolvedFoodItems): number {
  return items.reduce((sum, item) => sum + item.estimatedGrams, 0);
}

function hasExplicitMetricWeight(item: ResolvedFoodItem): boolean {
  const {unit} = parseQuantity(item.quantityDescription);
  return Boolean(unit && ['g', '克', 'ml', '毫升'].includes(unit));
}

function normalizeFoodIdentifier(foodName: string): string {
  return normalizeLookupText(sanitizeFoodName(foodName));
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (!sorted.length) {
    return 0;
  }

  if (sorted.length % 2 === 1) {
    return sorted[middle]!;
  }

  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function getReviewerLabel(provider: string): string {
  switch (provider) {
    case 'primary_model':
    case 'openrouter':
    case 'dashscope':
      return '主模型';
    case 'minimax':
      return 'MiniMax';
    case 'deepseek':
      return 'DeepSeek';
    default:
      return provider;
  }
}

function getReviewerCooldownStore(): Map<string, ReviewerCooldownState> {
  if (!global.__fitnessFoodReviewerCooldowns) {
    global.__fitnessFoodReviewerCooldowns = new Map();
  }

  return global.__fitnessFoodReviewerCooldowns;
}

function detectReviewerCooldownReason(
  message: string
): ReviewerCooldownState['reasonKind'] | null {
  const normalized = message.trim().toLowerCase();

  if (
    normalized.includes('429') ||
    normalized.includes('rate limited') ||
    normalized.includes('rate-limit') ||
    normalized.includes('temporarily rate-limited') ||
    normalized.includes('quota')
  ) {
    return 'rate_limit';
  }

  if (
    normalized.includes('timed out') ||
    normalized.includes('timeout') ||
    normalized.includes('time out')
  ) {
    return 'timeout';
  }

  if (
    normalized.includes('temporarily unavailable') ||
    normalized.includes('overloaded') ||
    normalized.includes('upstream')
  ) {
    return 'transient';
  }

  return null;
}

function shouldUseReviewerCooldown(provider: string): boolean {
  return provider !== 'primary_model';
}

function getReviewerCooldown(provider: string): ReviewerCooldownState | null {
  if (!shouldUseReviewerCooldown(provider)) {
    return null;
  }

  const store = getReviewerCooldownStore();
  const state = store.get(provider);
  if (!state) {
    return null;
  }

  if (state.disabledUntil <= Date.now()) {
    store.delete(provider);
    return null;
  }

  return state;
}

function clearReviewerCooldown(provider: string): void {
  if (!shouldUseReviewerCooldown(provider)) {
    return;
  }

  getReviewerCooldownStore().delete(provider);
}

function markReviewerCooldown(provider: string, message: string): void {
  if (!shouldUseReviewerCooldown(provider)) {
    return;
  }

  const reasonKind = detectReviewerCooldownReason(message);
  if (!reasonKind) {
    return;
  }

  getReviewerCooldownStore().set(provider, {
    disabledUntil: Date.now() + getOptionalReviewerCooldownMs(),
    reasonKind,
  });
}

function formatReviewerCooldownMessage(
  provider: string,
  state: ReviewerCooldownState
): string {
  const secondsRemaining = Math.max(
    1,
    Math.ceil((state.disabledUntil - Date.now()) / 1000)
  );
  const reasonLabel =
    state.reasonKind === 'rate_limit'
      ? '限流'
      : state.reasonKind === 'timeout'
        ? '超时'
        : '暂时不可用';

  return `${getReviewerLabel(provider)} 冷却中：上次${reasonLabel}后还需等待约 ${secondsRemaining} 秒`;
}

function summarizeReviewerFailure(provider: string, message: string): string {
  const label = getReviewerLabel(provider);
  const normalized = message.trim().toLowerCase();
  const cooldownReason = detectReviewerCooldownReason(message);

  if (normalized.includes('incompatible_review_result')) {
    return `${label} 返回结果不可兼容`;
  }

  if (cooldownReason === 'rate_limit') {
    return `${label} 速率限制`;
  }

  if (cooldownReason === 'timeout') {
    return `${label} 超时`;
  }

  if (cooldownReason === 'transient') {
    return `${label} 暂时不可用`;
  }

  if (normalized.includes('not configured')) {
    return `${label} 未配置`;
  }

  return `${label} 未返回`;
}

function pushFailureReason(reasons: string[], reason: string): void {
  if (reason && !reasons.includes(reason)) {
    reasons.push(reason);
  }
}

function formatFailureReason(
  summaryMessage: string | null,
  reasons: string[]
): string | null {
  const sections = [
    ...(summaryMessage ? [summaryMessage] : []),
    ...reasons,
  ];

  return sections.length ? sections.join('； ') : null;
}

function buildSummaryLabel(
  voteCount: number,
  reviewerCount: number,
  consensusScore: number,
  verdict: FoodReviewMeta['verdict'],
  successfulReviewerCount = reviewerCount
): string {
  if (!reviewerCount) {
    return '复核未启动';
  }

  if (verdict === 'failed') {
    if (!successfulReviewerCount) {
      return `复核失败 · 0/${reviewerCount} 返回`;
    }

    return `复核未形成共识 · ${successfulReviewerCount}/${reviewerCount} 返回`;
  }

  return `${voteCount}/${reviewerCount} 票支持 · 共识分 ${Math.round(consensusScore * 100)}`;
}

function getReviewVerdict(
  successfulReviewerCount: number,
  voteCount: number,
  consensusScore: number
): FoodReviewMeta['verdict'] {
  if (!successfulReviewerCount) {
    return 'failed';
  }

  if (successfulReviewerCount < MIN_SUCCESSFUL_REVIEWERS_FOR_CONSENSUS) {
    return 'failed';
  }

  const majority = Math.ceil(successfulReviewerCount / 2);
  if (voteCount >= majority && consensusScore >= 0.82) {
    return 'high';
  }
  if (voteCount >= majority && consensusScore >= 0.62) {
    return 'medium';
  }
  return 'low';
}

function calculateRelativeAgreement(
  value: number,
  baseline: number,
  tolerance: number,
  floor: number
): number {
  const delta = Math.abs(value - baseline) / Math.max(Math.abs(baseline), floor);
  return roundToTwoDecimals(clamp01(1 - delta / tolerance));
}

function calculateWeightAgreement(reviewWeight: number, finalWeight: number): number {
  return calculateRelativeAgreement(reviewWeight, finalWeight, 0.4, 25);
}

function calculateNutritionAgreement(
  reviewProfile: NutritionProfile23,
  consensusProfile: NutritionProfile23
): number {
  const scores = CORE_REVIEW_KEYS.map((key) => {
    const reviewValue = reviewProfile[key];
    const consensusValue = consensusProfile[key];
    if (typeof reviewValue !== 'number' || typeof consensusValue !== 'number') {
      return 0.5;
    }

    if (key === 'energyKcal') {
      return calculateRelativeAgreement(reviewValue, consensusValue, 0.45, 30);
    }

    return calculateRelativeAgreement(reviewValue, consensusValue, 0.5, 3);
  });

  return roundToTwoDecimals(average(scores));
}

function profilesEqual(left: NutritionProfile23, right: NutritionProfile23): boolean {
  return NUTRITION_PROFILE_KEYS.every((key) => left[key] === right[key]);
}

function buildFailureOutput(
  output: ParseFoodDescriptionOutput,
  failureFlag: ResolvedFoodItem['validationFlags'][number],
  summary: SecondaryReviewSummary
): ParseFoodDescriptionOutput {
  return rebuildOutputFromItems(
    {
      ...output,
      secondaryReviewSummary: summary,
    },
    output.items.map((item) => ({
      ...item,
      validationFlags: dedupeValidationFlags([
        ...item.validationFlags.filter(
          (flag) => !['ai_secondary_reviewed', 'ai_secondary_adjusted'].includes(flag)
        ),
        failureFlag,
      ]),
      reviewMeta: buildFailureReviewMeta({
        attempted: summary.attempted,
        providers: summary.providers,
        successfulProviders: summary.successfulProviders,
        failedProviders: summary.failedProviders,
      }),
    }))
  );
}

function buildAiReviewMeta(profile: NutritionProfile23): NutritionProfileMeta23 {
  return buildNutritionProfileMeta(profile, {
    knownStatus: 'estimated',
    knownSource: 'ai',
    missingSource: 'ai',
  });
}

function mergeReviewedNutritionByMeta(
  primary: NutritionProfile23,
  primaryMeta: NutritionProfileMeta23,
  fallback: NutritionProfile23,
  fallbackMeta: NutritionProfileMeta23
): {
  profile: NutritionProfile23;
  meta: NutritionProfileMeta23;
  filledKeys: Array<(typeof NUTRITION_PROFILE_KEYS)[number]>;
} {
  const profile = createNutritionProfile(primary);
  const meta = cloneNutritionProfileMeta(primaryMeta);
  const filledKeys: Array<(typeof NUTRITION_PROFILE_KEYS)[number]> = [];

  for (const key of NUTRITION_PROFILE_KEYS) {
    if (primaryMeta[key].status !== 'missing') {
      continue;
    }

    const fallbackValue = fallback[key];
    if (typeof fallbackValue !== 'number' || !Number.isFinite(fallbackValue)) {
      continue;
    }

    profile[key] = fallbackValue;
    meta[key] = {
      status: fallbackMeta[key].status === 'missing' ? 'estimated' : fallbackMeta[key].status,
      source:
        primaryMeta[key].source === 'database' || primaryMeta[key].source === 'database+ai'
          ? 'database+ai'
          : fallbackMeta[key].source,
    };
    filledKeys.push(key);
  }

  return {profile, meta, filledKeys};
}

function buildConsensusProfile(
  reviewItems: AiReviewedFoodItem[]
): NutritionProfile23 {
  return createNutritionProfile(
    NUTRITION_PROFILE_KEYS.reduce<Partial<NutritionProfile23>>((acc, key) => {
      const values = reviewItems
        .map((review) => review.reviewedPer100g[key])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

      acc[key] = values.length ? roundToSingleDecimal(median(values)) : null;
      return acc;
    }, {})
  );
}

function buildReviewVotes(params: {
  reviewItems: Array<{provider: string; item: AiReviewedFoodItem}>;
  consensusProfile: NutritionProfile23;
  finalEstimatedGrams: number;
  weightLocked: boolean;
}): ReviewerVote[] {
  return params.reviewItems.map(({provider, item}) => {
    const weightAgreement = params.weightLocked
      ? 1
      : calculateWeightAgreement(item.estimatedGrams, params.finalEstimatedGrams);
    const nutritionAgreement = calculateNutritionAgreement(
      item.reviewedPer100g,
      params.consensusProfile
    );
    const agreementScore = roundToTwoDecimals(
      params.weightLocked
        ? nutritionAgreement
        : average([weightAgreement, nutritionAgreement])
    );

    return {
      provider,
      providerLabel: getReviewerLabel(provider),
      supportsConsensus: agreementScore >= REVIEW_CONSENSUS_SUPPORT_THRESHOLD,
      agreementScore,
      estimatedGrams: item.estimatedGrams,
      confidence: item.confidence,
      reason: item.reason,
    };
  });
}

function buildFailureReviewMeta(params: {
  attempted?: boolean;
  providers: string[];
  successfulProviders?: string[];
  failedProviders?: string[];
  voteCount?: number;
  consensusScore?: number;
  summaryLabel?: string;
}): FoodReviewMeta {
  const successfulProviders = params.successfulProviders ?? [];
  const failedProviders = params.failedProviders ?? params.providers;
  const voteCount = params.voteCount ?? 0;
  const consensusScore = params.consensusScore ?? 0;

  return {
    attempted: params.attempted ?? true,
    reviewerCount: params.providers.length,
    successfulReviewerCount: successfulProviders.length,
    voteCount,
    consensusScore,
    verdict: 'failed',
    summaryLabel:
      params.summaryLabel ??
      buildSummaryLabel(
        voteCount,
        params.providers.length,
        consensusScore,
        'failed',
        successfulProviders.length
      ),
    providers: params.providers,
    successfulProviders,
    failedProviders,
    votes: [],
  };
}

function buildConsensusItem(
  item: ResolvedFoodItem,
  reviewItems: AiReviewedFoodItem[],
  weightLocked: boolean
): {
  item: ResolvedFoodItem;
  weightAdjusted: boolean;
  nutritionAdjusted: boolean;
} {
  const consensusProfile = buildConsensusProfile(reviewItems);
  const consensusMeta = buildAiReviewMeta(consensusProfile);
  const nextGrams = weightLocked
    ? item.estimatedGrams
    : Math.max(
        1,
        Math.round(median(reviewItems.map((review) => review.estimatedGrams)))
      );
  const reviewConfidence = roundToTwoDecimals(
    average(reviewItems.map((review) => review.confidence))
  );

  let nextPer100g = item.per100g;
  let nextPer100gMeta = cloneNutritionProfileMeta(item.per100gMeta);
  let nutritionAdjusted = false;

  if (item.sourceKind === 'ai_fallback') {
    nextPer100g = consensusProfile;
    nextPer100gMeta = consensusMeta;
    nutritionAdjusted = !profilesEqual(item.per100g, consensusProfile);
  } else {
    const merged = mergeReviewedNutritionByMeta(
      item.per100g,
      item.per100gMeta,
      consensusProfile,
      consensusMeta
    );
    nextPer100g = merged.profile;
    nextPer100gMeta = merged.meta;
    nutritionAdjusted = merged.filledKeys.length > 0;
  }

  const weightAdjusted = nextGrams !== item.estimatedGrams;
  const nextConfidence =
    item.sourceKind === 'ai_fallback'
      ? reviewConfidence
      : Math.max(item.confidence, reviewConfidence);
  const nextFlags = dedupeValidationFlags([
    ...item.validationFlags.filter((flag) => flag !== 'ai_secondary_review_failed'),
    'ai_secondary_reviewed',
    ...(weightAdjusted || nutritionAdjusted ? (['ai_secondary_adjusted'] as const) : []),
  ]);

  return {
    item: {
      ...item,
      estimatedGrams: nextGrams,
      confidence: nextConfidence,
      validationFlags: nextFlags,
      per100g: nextPer100g,
      per100gMeta: nextPer100gMeta,
      totals: scaleNutritionProfile(nextPer100g, nextGrams),
      totalsMeta: cloneNutritionProfileMeta(nextPer100gMeta),
    },
    weightAdjusted,
    nutritionAdjusted,
  };
}

function isCompatibleReview(
  foods: ResolvedFoodItems,
  reviewedItems: AiReviewedFoodItem[]
): boolean {
  if (reviewedItems.length !== foods.length) {
    return false;
  }

  return reviewedItems.every((review, index) => {
    const original = foods[index];
    return (
      review.index === index &&
      normalizeFoodIdentifier(review.foodName) ===
        normalizeFoodIdentifier(original?.foodName ?? '')
    );
  });
}

function rebuildSegment(
  segment: ParseFoodDescriptionSegment,
  items: ResolvedFoodItems
): ParseFoodDescriptionSegment {
  const totals = aggregateNutritionProfiles(
    items.map((item) => ({
      profile: item.totals,
      meta: item.totalsMeta,
    }))
  );

  return {
    ...segment,
    items,
    totalNutrition: totals.profile,
    totalNutritionMeta: totals.meta,
    totalWeight: sumWeight(items),
    overallConfidence: calculateOverallConfidence(items),
  };
}

function rebuildOutputFromItems(
  output: ParseFoodDescriptionOutput,
  items: ResolvedFoodItems
): ParseFoodDescriptionOutput {
  let offset = 0;

  const segments = output.segments.map((segment) => {
    const nextItems = items.slice(offset, offset + segment.items.length);
    offset += segment.items.length;
    return rebuildSegment(segment, nextItems);
  });

  const totals = aggregateNutritionProfiles(
    items.map((item) => ({
      profile: item.totals,
      meta: item.totalsMeta,
    }))
  );

  return ParseFoodDescriptionOutputSchema.parse({
    ...output,
    totalNutrition: totals.profile,
    totalNutritionMeta: totals.meta,
    totalWeight: sumWeight(items),
    overallConfidence: calculateOverallConfidence(items),
    items,
    segments,
    secondaryReviewSummary: output.secondaryReviewSummary ?? null,
  });
}

function createSingleSegmentOutput(
  foods: ResolvedFoodItems,
  sourceDescription: string
): ParseFoodDescriptionOutput {
  const totals = aggregateNutritionProfiles(
    foods.map((item) => ({
      profile: item.totals,
      meta: item.totalsMeta,
    }))
  );

  return ParseFoodDescriptionOutputSchema.parse({
    compositeDishName: null,
    totalNutrition: totals.profile,
    totalNutritionMeta: totals.meta,
    totalWeight: sumWeight(foods),
    overallConfidence: calculateOverallConfidence(foods),
    items: foods,
    segments: [
      {
        sourceDescription,
        compositeDishName: null,
        resolutionKind: 'direct_items',
        totalNutrition: totals.profile,
        totalNutritionMeta: totals.meta,
        totalWeight: sumWeight(foods),
        overallConfidence: calculateOverallConfidence(foods),
        items: foods,
        ingredientBreakdown: [],
      },
    ],
    secondaryReviewSummary: null,
  });
}

function getDefaultReviewers(): SecondaryReviewer[] {
  const deepseekReviewModel = getDeepseekReviewModel();
  const openRouterMinimaxReviewModel = getOpenRouterMinimaxReviewModel();
  const openRouterSerialGroup = process.env.OPENROUTER_API_KEY?.trim()
    ? 'openrouter'
    : undefined;

  return [
    {
      provider: 'primary_model',
      serialGroup: openRouterSerialGroup,
      review: reviewResolvedFoodsWithPrimaryModel,
    },
    ...(isOptionalReviewerEnabled('openrouter_minimax') && openRouterMinimaxReviewModel
      ? [
          {
            provider: openRouterMinimaxReviewModel.provider,
            serialGroup: openRouterSerialGroup,
            review: reviewResolvedFoodsWithOpenRouterMinimax,
          } satisfies SecondaryReviewer,
        ]
      : []),
    ...(isOptionalReviewerEnabled('deepseek') && deepseekReviewModel
      ? [
          {
            provider: deepseekReviewModel.provider,
            review: reviewResolvedFoodsWithDeepseek,
          } satisfies SecondaryReviewer,
        ]
      : []),
  ];
}

async function runSecondaryReviewers(params: {
  reviewers: SecondaryReviewer[];
  sourceDescription: string;
  foods: ResolvedFoodItems;
  weightLocks: boolean[];
}): Promise<Array<{
  provider: string;
  result: PromiseSettledResult<{provider: string; items: AiReviewedFoodItem[]}>;
}>> {
  const independent: SecondaryReviewer[] = [];
  const grouped = new Map<string, SecondaryReviewer[]>();

  for (const reviewer of params.reviewers) {
    if (!reviewer.serialGroup) {
      independent.push(reviewer);
      continue;
    }

    const bucket = grouped.get(reviewer.serialGroup) ?? [];
    bucket.push(reviewer);
    grouped.set(reviewer.serialGroup, bucket);
  }

  const independentResults = await Promise.all(
    independent.map(async (reviewer) => {
      try {
        return {
          provider: reviewer.provider,
          result: {
            status: 'fulfilled' as const,
            value: {
              provider: reviewer.provider,
              items: await reviewer.review(
                params.sourceDescription,
                params.foods,
                params.weightLocks
              ),
            },
          },
        };
      } catch (reason) {
        return {
          provider: reviewer.provider,
          result: {
            status: 'rejected' as const,
            reason,
          },
        };
      }
    })
  );

  const groupedResults = await Promise.all(
    Array.from(grouped.values()).map(async (reviewers) => {
      const results: Array<{
        provider: string;
        result: PromiseSettledResult<{provider: string; items: AiReviewedFoodItem[]}>;
      }> = [];

      for (const reviewer of reviewers) {
        try {
          results.push({
            provider: reviewer.provider,
            result: {
              status: 'fulfilled',
              value: {
                provider: reviewer.provider,
                items: await reviewer.review(
                  params.sourceDescription,
                  params.foods,
                  params.weightLocks
                ),
              },
            },
          });
        } catch (reason) {
          results.push({
            provider: reviewer.provider,
            result: {
              status: 'rejected',
              reason,
            },
          });
        }
      }

      return results;
    })
  );

  return [...independentResults, ...groupedResults.flat()];
}

export function buildParseOutputFromFoods(
  foods: ResolvedFoodItems,
  sourceDescription?: string | null
): ParseFoodDescriptionOutput {
  return createSingleSegmentOutput(
    foods,
    sourceDescription?.trim() || foods[0]?.foodName || '已编辑食物'
  );
}

export async function applySecondaryReviewToOutput(params: {
  sourceDescription: string;
  output: ParseFoodDescriptionOutput;
  lockExplicitMetricWeights: boolean;
  reviewers?: SecondaryReviewer[];
}): Promise<{
  output: ParseFoodDescriptionOutput;
  summary: SecondaryReviewSummary;
}> {
  const reviewers = params.reviewers ?? getDefaultReviewers();
  const providers = reviewers.map((reviewer) => reviewer.provider);
  const failureReasons: string[] = [];

  if (!reviewers.length) {
    const summary: SecondaryReviewSummary = {
      attempted: false,
      succeeded: false,
      providerCount: 0,
      successfulReviewerCount: 0,
      voteCount: 0,
      consensusScore: 0,
      changedItemCount: 0,
      adjustedWeightCount: 0,
      adjustedNutritionCount: 0,
      providers: [],
      successfulProviders: [],
      failedProviders: [],
      failureReason: '未配置可用的二次复核 reviewer。',
    };

    return {
      output: buildFailureOutput(
        params.output,
        'ai_secondary_review_failed',
        summary
      ),
      summary,
    };
  }

  const activeReviewers = reviewers.filter((reviewer) => {
    const cooldown = getReviewerCooldown(reviewer.provider);
    if (!cooldown) {
      return true;
    }

    pushFailureReason(
      failureReasons,
      formatReviewerCooldownMessage(reviewer.provider, cooldown)
    );
    return false;
  });

  if (!activeReviewers.length) {
    const summary: SecondaryReviewSummary = {
      attempted: true,
      succeeded: false,
      providerCount: reviewers.length,
      successfulReviewerCount: 0,
      voteCount: 0,
      consensusScore: 0,
      changedItemCount: 0,
      adjustedWeightCount: 0,
      adjustedNutritionCount: 0,
      providers,
      successfulProviders: [],
      failedProviders: providers,
      failureReason:
        formatFailureReason(null, failureReasons) ?? '所有复核 reviewer 当前都处于冷却中。',
    };

    return {
      output: buildFailureOutput(
        params.output,
        'ai_secondary_review_failed',
        summary
      ),
      summary,
    };
  }

  const foods = params.output.items;
  const weightLocks = foods.map((item) =>
    params.lockExplicitMetricWeights ? hasExplicitMetricWeight(item) : false
  );

  const settled = await runSecondaryReviewers({
    reviewers: activeReviewers,
    sourceDescription: params.sourceDescription,
    foods,
    weightLocks,
  });

  const compatibleReviews: Array<{provider: string; items: AiReviewedFoodItem[]}> = [];

  await Promise.all(
    settled.map(async ({provider, result}, index) => {
      const fallbackProvider =
        activeReviewers[index]?.provider ?? `reviewer_${index + 1}`;
      const reviewerProvider = provider || fallbackProvider;
      if (result.status === 'rejected') {
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        pushFailureReason(
          failureReasons,
          summarizeReviewerFailure(reviewerProvider, message)
        );
        markReviewerCooldown(reviewerProvider, message);
        await recordRuntimeError({
          scope: 'secondary_review',
          code: 'reviewer_failed',
          message,
          context: {
            provider: reviewerProvider,
            sourceDescription: params.sourceDescription,
          },
        });
        return;
      }

      if (!isCompatibleReview(foods, result.value.items)) {
        pushFailureReason(
          failureReasons,
          summarizeReviewerFailure(reviewerProvider, 'incompatible_review_result')
        );
        await recordRuntimeError({
          scope: 'secondary_review',
          code: 'reviewer_incompatible_result',
          message: 'Reviewer returned mismatched item count, order, or food name.',
          context: {
            provider: reviewerProvider,
            sourceDescription: params.sourceDescription,
          },
        });
        return;
      }

      clearReviewerCooldown(reviewerProvider);
      compatibleReviews.push(result.value);
    })
  );
  const successfulProviders = compatibleReviews.map((review) => review.provider);
  const failedProviders = providers.filter(
    (provider) => !successfulProviders.includes(provider)
  );

  if (!compatibleReviews.length) {
    const summary: SecondaryReviewSummary = {
      attempted: true,
      succeeded: false,
      providerCount: reviewers.length,
      successfulReviewerCount: 0,
      voteCount: 0,
      consensusScore: 0,
      changedItemCount: 0,
      adjustedWeightCount: 0,
      adjustedNutritionCount: 0,
      providers,
      successfulProviders: [],
      failedProviders,
      failureReason:
        formatFailureReason(null, failureReasons) ?? '本轮复核未返回兼容结果。',
    };

    return {
      output: buildFailureOutput(
        params.output,
        'ai_secondary_review_failed',
        summary
      ),
      summary,
    };
  }

  if (compatibleReviews.length < MIN_SUCCESSFUL_REVIEWERS_FOR_CONSENSUS) {
    const summary: SecondaryReviewSummary = {
      attempted: true,
      succeeded: false,
      providerCount: reviewers.length,
      successfulReviewerCount: compatibleReviews.length,
      voteCount: 0,
      consensusScore: 0,
      changedItemCount: 0,
      adjustedWeightCount: 0,
      adjustedNutritionCount: 0,
      providers,
      successfulProviders,
      failedProviders,
      failureReason:
        formatFailureReason(
          `本轮仅 ${compatibleReviews.length}/${reviewers.length} 个 reviewer 返回，不足以形成可信共识，已保留复核前结果。`,
          failureReasons
        ) ??
        `本轮仅 ${compatibleReviews.length}/${reviewers.length} 个 reviewer 返回，不足以形成可信共识，已保留复核前结果。`,
    };

    return {
      output: buildFailureOutput(
        params.output,
        'ai_secondary_review_failed',
        summary
      ),
      summary,
    };
  }

  let changedItemCount = 0;
  let adjustedWeightCount = 0;
  let adjustedNutritionCount = 0;
  const providerAgreementScores = new Map<string, number[]>();
  for (const provider of successfulProviders) {
    providerAgreementScores.set(provider, []);
  }

  const reviewedItems = foods.map((food, index) => {
    const reviewItems = compatibleReviews.map((review) => ({
      provider: review.provider,
      item: review.items[index]!,
    }));
    const merged = buildConsensusItem(
      food,
      reviewItems.map(({item}) => item),
      weightLocks[index] ?? false
    );
    const consensusProfile = buildConsensusProfile(reviewItems.map(({item}) => item));
    const votes = buildReviewVotes({
      reviewItems,
      consensusProfile,
      finalEstimatedGrams: merged.item.estimatedGrams,
      weightLocked: weightLocks[index] ?? false,
    });

    for (const vote of votes) {
      const scores = providerAgreementScores.get(vote.provider);
      if (scores) {
        scores.push(vote.agreementScore);
      }
    }

    const voteCount = votes.filter((vote) => vote.supportsConsensus).length;
    const consensusScore = roundToTwoDecimals(
      average(votes.map((vote) => vote.agreementScore))
    );
    const verdict = getReviewVerdict(
      compatibleReviews.length,
      voteCount,
      consensusScore
    );

    if (merged.weightAdjusted || merged.nutritionAdjusted) {
      changedItemCount += 1;
    }

    if (merged.weightAdjusted) {
      adjustedWeightCount += 1;
    }

    if (merged.nutritionAdjusted) {
      adjustedNutritionCount += 1;
    }

    return {
      ...merged.item,
      reviewMeta: {
        attempted: true,
        reviewerCount: reviewers.length,
        successfulReviewerCount: compatibleReviews.length,
        voteCount,
        consensusScore,
        verdict,
        summaryLabel: buildSummaryLabel(
          voteCount,
          reviewers.length,
          consensusScore,
          verdict,
          compatibleReviews.length
        ),
        providers,
        successfulProviders,
        failedProviders,
        votes,
      },
    };
  });
  const providerConsensusScores = successfulProviders.map((provider) =>
    roundToTwoDecimals(average(providerAgreementScores.get(provider) ?? []))
  );
  const voteCount = providerConsensusScores.filter(
    (score) => score >= REVIEW_CONSENSUS_SUPPORT_THRESHOLD
  ).length;
  const consensusScore = roundToTwoDecimals(average(providerConsensusScores));
  const summary: SecondaryReviewSummary = {
    attempted: true,
    succeeded: true,
    providerCount: reviewers.length,
    successfulReviewerCount: compatibleReviews.length,
    voteCount,
    consensusScore,
    changedItemCount,
    adjustedWeightCount,
    adjustedNutritionCount,
    providers,
    successfulProviders,
    failedProviders,
    failureReason: formatFailureReason(null, failureReasons),
  };

  return {
    output: rebuildOutputFromItems(
      {
        ...params.output,
        secondaryReviewSummary: summary,
      },
      reviewedItems
    ),
    summary,
  };
}
