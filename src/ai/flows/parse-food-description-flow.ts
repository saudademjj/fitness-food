'use server';

import {
  ParseFoodDescriptionInputSchema,
  ParseFoodDescriptionOutputSchema,
  type AiParsedFoodItem,
  type ParseFoodDescriptionInput,
  type ParseFoodDescriptionOutput,
  type ResolvedFoodItem,
} from '@/lib/food-contract';
import {tryResolveDirectDescription} from '@/lib/direct-food-parser';
import {
  COMPOSITE_FOOD_PATTERN,
  extractSingleFoodCandidate,
  extractWholeDishCandidate,
  parseQuantity,
  sanitizeFoodName,
  splitFoodDescriptionSegments,
} from '@/lib/food-text';
import {parseFoodCandidatesWithGemini} from '@/lib/gemini';
import {
  aggregateNutritionProfiles,
  buildNutritionProfileMeta,
  cloneNutritionProfileMeta,
  coalesceNutritionValue,
  convertTotalsToPer100g,
  createNutritionProfile,
  createNutritionProfileMeta,
  hasAnyNutritionValue,
  mergeNutritionProfiles,
  scaleNutritionProfile,
  sumNutritionProfiles,
  NON_CORE_NUTRITION_KEYS,
  type NutritionFieldKey,
  type NutritionProfile23,
  type NutritionProfileMeta23,
} from '@/lib/nutrition-profile';
import {
  applyPreparationNutritionAdjustments,
  estimateGrams,
} from '@/lib/portion-reference';
import {
  createNutritionLookupResolver,
  type NutritionLookupResolver,
  type NutritionLookupResult,
} from '@/lib/nutrition-db';
import {dedupeValidationFlags} from '@/lib/validation';

function sanitizeCandidate(candidate: AiParsedFoodItem): AiParsedFoodItem {
  return {
    ...candidate,
    foodName: sanitizeFoodName(candidate.foodName),
    quantityDescription: candidate.quantityDescription.trim() || '未知',
  };
}

function getFallbackMeta(candidate: AiParsedFoodItem): NutritionProfileMeta23 {
  return (
    candidate.fallbackPer100gMeta ??
    buildNutritionProfileMeta(candidate.fallbackPer100g, {
      knownStatus: 'estimated',
      knownSource: 'ai',
      missingSource: 'ai',
    })
  );
}

async function chooseEstimatedGrams(
  candidate: AiParsedFoodItem,
  matchedName?: string | null
): Promise<{
  estimatedGrams: number;
  validationFlags: ResolvedFoodItem['validationFlags'];
}> {
  const estimated = await estimateGrams(
    candidate.foodName,
    candidate.quantityDescription,
    matchedName
  );
  const {unit} = parseQuantity(candidate.quantityDescription);
  const hasExplicitMetricUnit = Boolean(unit && ['g', '克', 'ml', '毫升'].includes(unit));
  const hasCandidateEstimate =
    Number.isFinite(candidate.estimatedGrams) && candidate.estimatedGrams > 0;
  const hasHighConfidenceCandidateEstimate = hasCandidateEstimate && candidate.confidence >= 0.75;
  const portionMatchStrategy = estimated.portion?.matchStrategy ?? 'fallback';

  if (hasExplicitMetricUnit) {
    return {
      estimatedGrams: estimated.grams,
      validationFlags: estimated.validationFlags,
    };
  }

  if (portionMatchStrategy === 'exact') {
    return {
      estimatedGrams: estimated.grams,
      validationFlags: estimated.validationFlags,
    };
  }

  if (hasHighConfidenceCandidateEstimate && portionMatchStrategy === 'keyword') {
    const delta =
      Math.abs(candidate.estimatedGrams - estimated.grams) /
      Math.max(candidate.estimatedGrams, estimated.grams, 1);

    return {
      estimatedGrams:
        delta <= 0.3 || estimated.confidenceScore >= 0.85
          ? estimated.grams
          : candidate.estimatedGrams,
      validationFlags: estimated.validationFlags,
    };
  }

  if (hasHighConfidenceCandidateEstimate && portionMatchStrategy === 'fallback') {
    const delta =
      Math.abs(candidate.estimatedGrams - estimated.grams) /
      Math.max(candidate.estimatedGrams, estimated.grams, 1);

    return {
      estimatedGrams:
        delta <= 0.35 || candidate.confidence >= 0.9
          ? candidate.estimatedGrams
          : estimated.grams,
      validationFlags: estimated.validationFlags,
    };
  }

  return {
    estimatedGrams: estimated.grams,
    validationFlags: estimated.validationFlags,
  };
}

function summarizeMissingNutrition(
  meta: NutritionProfileMeta23,
  keys: NutritionFieldKey[] = NON_CORE_NUTRITION_KEYS
): NutritionFieldKey[] {
  return keys.filter((key) => meta[key].status === 'missing');
}

function buildResolvedFood(
  candidate: AiParsedFoodItem,
  dbMatch: NutritionLookupResult | null,
  estimatedGrams: number,
  validationFlags: ResolvedFoodItem['validationFlags']
): ResolvedFoodItem {
  const fallbackMeta = getFallbackMeta(candidate);
  const fallbackPreparation = applyPreparationNutritionAdjustments(
    candidate.fallbackPer100g,
    fallbackMeta,
    candidate.foodName
  );

  let per100g = fallbackPreparation.profile;
  let per100gMeta = fallbackPreparation.meta;
  let sourceLabel = candidate.fallbackAdjusted ? 'AI 保守修正估算' : 'AI 估算';
  let confidence = Math.min(
    candidate.confidence,
    candidate.fallbackAdjusted ? 0.45 : 0.65,
    candidate.fallbackValidationIssues.length ? 0.35 : 1
  );
  const fallbackFlags: ResolvedFoodItem['validationFlags'] = [
    'ai_macro_estimate',
    'db_lookup_miss',
    ...(candidate.fallbackAdjusted ? (['ai_macro_clamped'] as const) : []),
    ...(candidate.fallbackValidationIssues.length ? (['ai_macro_unverified'] as const) : []),
  ];

  if (dbMatch) {
    const merged = mergeNutritionProfiles(
      dbMatch.per100g,
      dbMatch.per100gMeta,
      candidate.fallbackPer100g,
      fallbackMeta,
      NON_CORE_NUTRITION_KEYS
    );
    const prepared = applyPreparationNutritionAdjustments(
      merged.profile,
      merged.meta,
      candidate.foodName,
      dbMatch.matchedName
    );
    per100g = prepared.profile;
    per100gMeta = prepared.meta;
    sourceLabel = dbMatch.sourceLabel;
    confidence =
      merged.filledKeys.length > 0
        ? Math.min(candidate.confidence, dbMatch.matchMode === 'exact' ? 0.88 : 0.8)
        : candidate.confidence;

    fallbackFlags.length = 0;
    if (merged.filledKeys.length > 0) {
      fallbackFlags.push('db_micronutrient_ai_merged');
      sourceLabel = `${dbMatch.sourceLabel} · AI 补齐 ${merged.filledKeys.length} 项缺失营养`;
    }
  }

  const missingFields = summarizeMissingNutrition(per100gMeta);
  if (missingFields.length > 0) {
    fallbackFlags.push('nutrition_partial', 'nutrition_unknown');
  }

  const baselineFlags =
    dbMatch?.validationFlags.filter((flag) => {
      if (flag === 'db_micronutrient_gap' || flag === 'nutrition_partial' || flag === 'nutrition_unknown') {
        return missingFields.length > 0;
      }
      return true;
    }) ?? [];
  const combinedFlags = dedupeValidationFlags([
    ...baselineFlags,
    ...fallbackFlags,
    ...validationFlags,
  ]);

  return {
    foodName: candidate.foodName,
    quantityDescription: candidate.quantityDescription,
    estimatedGrams,
    confidence: dbMatch ? confidence : Math.min(confidence, missingFields.length ? 0.5 : 0.65),
    sourceKind: dbMatch?.sourceKind ?? 'ai_fallback',
    sourceLabel,
    matchMode: dbMatch?.matchMode ?? 'ai_fallback',
    sourceStatus: dbMatch?.sourceStatus ?? 'published',
    amountBasisG: dbMatch?.amountBasisG ?? 100,
    validationFlags: dedupeValidationFlags(
      confidence < 0.65 ? [...combinedFlags, 'low_confidence'] : combinedFlags
    ),
    per100g,
    per100gMeta,
    totals: scaleNutritionProfile(per100g, estimatedGrams),
    totalsMeta: cloneNutritionProfileMeta(per100gMeta),
  };
}

async function resolveCandidate(
  candidate: AiParsedFoodItem,
  lookupResolver: NutritionLookupResolver
): Promise<ResolvedFoodItem[]> {
  const normalizedCandidate = sanitizeCandidate(candidate);
  const dbMatch = await lookupResolver(normalizedCandidate.foodName, {
    allowFuzzy: !COMPOSITE_FOOD_PATTERN.test(normalizedCandidate.foodName),
    recordMiss: true,
  });
  const estimated = await chooseEstimatedGrams(normalizedCandidate, dbMatch?.matchedName);

  return [
    buildResolvedFood(
      normalizedCandidate,
      dbMatch,
      estimated.estimatedGrams,
      estimated.validationFlags
    ),
  ];
}

function extractSingleMetricWeight(description: string): number | null {
  const matches = [...description.matchAll(/(\d+(?:\.\d+)?)\s*(?:g|克|ml|毫升)/gi)];
  if (!matches.length) {
    return null;
  }

  const total = matches.reduce((sum, match) => {
    const value = Number.parseFloat(match[1] ?? '');
    return Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);
  return total > 0 ? total : null;
}

async function determineTargetTotalWeight(
  description: string,
  foods: ParseFoodDescriptionOutput
): Promise<number | null> {
  const explicitWeight = extractSingleMetricWeight(description);
  if (explicitWeight) {
    return explicitWeight;
  }

  if (foods.length < 2) {
    return null;
  }

  const candidate = extractSingleFoodCandidate(description) ?? extractWholeDishCandidate(description);
  if (!candidate?.foodName) {
    return null;
  }

  const estimated = await estimateGrams(
    candidate.foodName,
    candidate.quantityDescription,
    candidate.foodName
  );
  return estimated.grams > 0 ? estimated.grams : null;
}

function rebalanceResolvedFoods(
  foods: ParseFoodDescriptionOutput,
  totalWeight: number | null
): ParseFoodDescriptionOutput {
  if (!totalWeight || foods.length < 2) {
    return foods;
  }

  const currentTotalWeight = foods.reduce((sum, item) => sum + item.estimatedGrams, 0);
  if (!currentTotalWeight || Math.abs(currentTotalWeight - totalWeight) < 5) {
    return foods;
  }

  const preservedFoods = foods.filter((item) => item.sourceKind !== 'ai_fallback');
  const estimatedFoods = foods.filter((item) => item.sourceKind === 'ai_fallback');
  const adjustableFoods =
    preservedFoods.length > 0 && estimatedFoods.length > 0 ? estimatedFoods : foods;
  const lockedWeight =
    adjustableFoods === foods
      ? 0
      : preservedFoods.reduce((sum, item) => sum + item.estimatedGrams, 0);
  const adjustableWeight = adjustableFoods.reduce((sum, item) => sum + item.estimatedGrams, 0);
  const targetAdjustableWeight = totalWeight - lockedWeight;

  if (targetAdjustableWeight <= 0 || adjustableWeight <= 0) {
    return foods;
  }

  return foods.map((item) => {
    if (adjustableFoods !== foods && item.sourceKind !== 'ai_fallback') {
      return item;
    }

    const nextGrams = Math.max(
      1,
      Math.round((item.estimatedGrams / adjustableWeight) * targetAdjustableWeight)
    );
    return {
      ...item,
      estimatedGrams: nextGrams,
      validationFlags: dedupeValidationFlags([
        ...item.validationFlags,
        'composite_total_rebalanced',
      ]),
      totals: scaleNutritionProfile(item.per100g, nextGrams),
      totalsMeta: cloneNutritionProfileMeta(item.per100gMeta),
    };
  });
}

function computeCoreDeltaRatio(a: number | null, b: number | null): number {
  return Math.abs(coalesceNutritionValue(a) - coalesceNutritionValue(b)) /
    Math.max(coalesceNutritionValue(a), coalesceNutritionValue(b), 1);
}

function alignComponentsToWholeDish(
  foods: ParseFoodDescriptionOutput,
  wholeDishTotals: NutritionProfile23,
  wholeDishTotalsMeta: NutritionProfileMeta23
): ParseFoodDescriptionOutput {
  const preservedFoods = foods.filter((item) => item.sourceKind !== 'ai_fallback');
  const estimatedFoods = foods.filter((item) => item.sourceKind === 'ai_fallback');
  if (!estimatedFoods.length) {
    return foods;
  }

  const preservedTotals = sumNutritionProfiles(preservedFoods.map((item) => item.totals));
  const estimatedTotals = sumNutritionProfiles(estimatedFoods.map((item) => item.totals));
  const estimatedWeight = estimatedFoods.reduce((sum, item) => sum + item.estimatedGrams, 0);

  const remainingTotals = createNutritionProfile(
    (Object.keys(wholeDishTotals) as NutritionFieldKey[]).reduce(
      (acc, key) => {
        acc[key] =
          wholeDishTotals[key] === null
            ? null
            : Number(
                Math.max(
                  coalesceNutritionValue(wholeDishTotals[key]) -
                    coalesceNutritionValue(preservedTotals[key]),
                  0
                ).toFixed(1)
              );
        return acc;
      },
      {} as Record<NutritionFieldKey, number | null>
    )
  );

  const lockedMacroOverflow = ['energyKcal', 'proteinGrams', 'carbohydrateGrams', 'fatGrams'].some(
    (key) =>
      coalesceNutritionValue(
        preservedTotals[key as keyof NutritionProfile23]
      ) >
      coalesceNutritionValue(wholeDishTotals[key as keyof NutritionProfile23]) + 5
  );
  if (lockedMacroOverflow) {
    return foods;
  }

  return foods.map((item) => {
    if (item.sourceKind !== 'ai_fallback') {
      return item;
    }

    const alignedTotals = createNutritionProfile(
      (Object.keys(wholeDishTotals) as NutritionFieldKey[]).reduce(
        (acc, key) => {
          if (remainingTotals[key] === null) {
            acc[key] = null;
            return acc;
          }

          const denominator = coalesceNutritionValue(estimatedTotals[key]);
          const share =
            denominator > 0
              ? coalesceNutritionValue(item.totals[key]) / denominator
              : estimatedWeight > 0
                ? item.estimatedGrams / estimatedWeight
                : 1 / estimatedFoods.length;
          acc[key] = Number((coalesceNutritionValue(remainingTotals[key]) * share).toFixed(1));
          return acc;
        },
        {} as Record<NutritionFieldKey, number | null>
      )
    );

    const alignedMeta = createNutritionProfileMeta(
      (Object.keys(wholeDishTotalsMeta) as NutritionFieldKey[]).reduce(
        (acc, key) => {
          acc[key] =
            wholeDishTotalsMeta[key].status === 'missing'
              ? wholeDishTotalsMeta[key]
              : {
                  status: 'estimated',
                  source: wholeDishTotalsMeta[key].source,
                };
          return acc;
        },
        {} as Partial<NutritionProfileMeta23>
      )
    );

    return {
      ...item,
      per100g: convertTotalsToPer100g(alignedTotals, item.estimatedGrams),
      per100gMeta: cloneNutritionProfileMeta(alignedMeta),
      totals: alignedTotals,
      totalsMeta: alignedMeta,
      validationFlags: dedupeValidationFlags([
        ...item.validationFlags,
        'whole_dish_component_aligned',
      ]),
    };
  });
}

async function maybeOverrideWithWholeDish(
  description: string,
  foods: ParseFoodDescriptionOutput,
  lookupResolver: NutritionLookupResolver,
  wholeDishMatch?: NutritionLookupResult | null
): Promise<ParseFoodDescriptionOutput> {
  const candidate =
    extractWholeDishCandidate(description) ?? extractSingleFoodCandidate(description);
  if (!candidate?.foodName) {
    return foods;
  }

  const resolvedWholeDish =
    wholeDishMatch ??
    (await lookupResolver(candidate.foodName, {
      allowFuzzy: true,
    }));
  if (!resolvedWholeDish) {
    return foods;
  }

  const estimated = await estimateGrams(
    candidate.foodName,
    candidate.quantityDescription,
    resolvedWholeDish.matchedName
  );
  const wholeDishPrepared = applyPreparationNutritionAdjustments(
    resolvedWholeDish.per100g,
    resolvedWholeDish.per100gMeta,
    candidate.foodName,
    resolvedWholeDish.matchedName
  );
  const wholeDishTotals = scaleNutritionProfile(wholeDishPrepared.profile, estimated.grams);
  const wholeDishTotalsMeta = cloneNutritionProfileMeta(wholeDishPrepared.meta);
  const aggregatedDecomposed = aggregateNutritionProfiles(
    foods.map((item) => ({
      profile: item.totals,
      meta: item.totalsMeta,
    }))
  );

  const energyDelta = computeCoreDeltaRatio(
    wholeDishTotals.energyKcal,
    aggregatedDecomposed.profile.energyKcal
  );
  const proteinDelta = computeCoreDeltaRatio(
    wholeDishTotals.proteinGrams,
    aggregatedDecomposed.profile.proteinGrams
  );
  const carbohydrateDelta = computeCoreDeltaRatio(
    wholeDishTotals.carbohydrateGrams,
    aggregatedDecomposed.profile.carbohydrateGrams
  );
  const fatDelta = computeCoreDeltaRatio(
    wholeDishTotals.fatGrams,
    aggregatedDecomposed.profile.fatGrams
  );

  if (
    energyDelta <= 0.15 &&
    proteinDelta <= 0.2 &&
    carbohydrateDelta <= 0.2 &&
    fatDelta <= 0.2
  ) {
    return alignComponentsToWholeDish(foods, wholeDishTotals, wholeDishTotalsMeta);
  }

  if (resolvedWholeDish.matchMode === 'fuzzy') {
    return foods;
  }

  return [
    {
      foodName: resolvedWholeDish.matchedName,
      quantityDescription: candidate.quantityDescription,
      estimatedGrams: estimated.grams,
      confidence: 0.92,
      sourceKind: resolvedWholeDish.sourceKind,
      sourceLabel: resolvedWholeDish.sourceLabel,
      matchMode: resolvedWholeDish.matchMode,
      sourceStatus: resolvedWholeDish.sourceStatus,
      amountBasisG: resolvedWholeDish.amountBasisG,
      validationFlags: dedupeValidationFlags([
        ...resolvedWholeDish.validationFlags,
        ...estimated.validationFlags,
        'whole_dish_db_override',
      ]),
      per100g: wholeDishPrepared.profile,
      per100gMeta: wholeDishPrepared.meta,
      totals: wholeDishTotals,
      totalsMeta: wholeDishTotalsMeta,
    },
  ];
}

async function resolveDescriptionSegment(
  description: string,
  lookupResolver: NutritionLookupResolver
): Promise<ParseFoodDescriptionOutput> {
  const directlyResolvedFoods = await tryResolveDirectDescription(description, lookupResolver);
  if (directlyResolvedFoods?.length) {
    return directlyResolvedFoods;
  }

  const wholeDishCandidate =
    extractWholeDishCandidate(description) ??
    (() => {
      const candidate = extractSingleFoodCandidate(description);
      return candidate?.foodName && COMPOSITE_FOOD_PATTERN.test(candidate.foodName)
        ? candidate
        : null;
    })();
  const wholeDishMatch = wholeDishCandidate?.foodName
    ? await lookupResolver(wholeDishCandidate.foodName, {
        allowFuzzy: true,
      })
    : null;

  const candidates = await parseFoodCandidatesWithGemini(description);
  const resolvedFoods = (await Promise.all(
    candidates.map((candidate) => resolveCandidate(candidate, lookupResolver))
  )).flat();
  const targetTotalWeight = await determineTargetTotalWeight(description, resolvedFoods);
  const rebalancedFoods = rebalanceResolvedFoods(resolvedFoods, targetTotalWeight);

  if (!wholeDishCandidate?.foodName) {
    return rebalancedFoods;
  }

  return maybeOverrideWithWholeDish(
    description,
    rebalancedFoods,
    lookupResolver,
    wholeDishMatch
  );
}

export async function parseFoodDescription(
  input: ParseFoodDescriptionInput
): Promise<ParseFoodDescriptionOutput> {
  const parsedInput = ParseFoodDescriptionInputSchema.parse(input);
  const lookupResolver = createNutritionLookupResolver();
  const segments = splitFoodDescriptionSegments(parsedInput.description);
  const effectiveSegments = segments.length > 1 ? segments : [parsedInput.description];

  const segmentResults = await Promise.all(
    effectiveSegments.map((segment) => resolveDescriptionSegment(segment, lookupResolver))
  );
  return ParseFoodDescriptionOutputSchema.parse(segmentResults.flat());
}
