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
  parseQuantity,
  sanitizeFoodName,
  splitFoodDescriptionSegments,
} from '@/lib/food-text';
import {
  convertTotalsToPer100g,
  createNutritionProfile,
  hasAnyNutritionValue,
  scaleNutritionProfile,
  sumNutritionProfiles,
  type NutritionFieldKey,
  type NutritionProfile23,
} from '@/lib/nutrition-profile';
import {
  applyPreparationNutritionAdjustments,
  estimateGrams,
} from '@/lib/portion-reference';
import {
  lookupNutritionByNameExact,
  lookupNutritionByNameFuzzy,
  type NutritionLookupResult,
} from '@/lib/nutrition-db';
import {recordLookupMiss} from '@/lib/miss-telemetry';
import {parseFoodCandidatesWithGemini} from '@/lib/gemini';
import {dedupeValidationFlags} from '@/lib/validation';

function sanitizeCandidate(candidate: AiParsedFoodItem): AiParsedFoodItem {
  return {
    ...candidate,
    foodName: sanitizeFoodName(candidate.foodName),
    quantityDescription: candidate.quantityDescription.trim() || '未知',
  };
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
    return {
      estimatedGrams: candidate.estimatedGrams,
      validationFlags: estimated.validationFlags,
    };
  }

  return {
    estimatedGrams: estimated.grams,
    validationFlags: estimated.validationFlags,
  };
}

function buildResolvedFood(
  candidate: AiParsedFoodItem,
  dbMatch: NutritionLookupResult | null,
  estimatedGrams: number,
  validationFlags: ResolvedFoodItem['validationFlags']
): ResolvedFoodItem {
  const basePer100g = dbMatch?.per100g ?? candidate.fallbackPer100g;
  const per100g = dbMatch
    ? applyPreparationNutritionAdjustments(
        basePer100g,
        candidate.foodName,
        dbMatch.matchedName
      )
    : basePer100g;
  const fallbackMissing = !dbMatch && !hasAnyNutritionValue(per100g);
  const fallbackFlags: ResolvedFoodItem['validationFlags'] = !dbMatch
    ? [
        'ai_macro_estimate',
        'db_lookup_miss',
        ...(candidate.fallbackAdjusted ? (['ai_macro_clamped'] as const) : []),
        ...(candidate.fallbackValidationIssues.length ? (['ai_macro_unverified'] as const) : []),
        ...(fallbackMissing ? (['ai_macro_unverified'] as const) : []),
      ]
    : [];
  const sourceLabel = dbMatch
    ? dbMatch.sourceLabel
    : candidate.fallbackAdjusted
      ? 'AI 保守修正估算'
      : 'AI 估算';
  const confidence = dbMatch
    ? candidate.confidence
    : Math.min(
        candidate.confidence,
        candidate.fallbackAdjusted ? 0.45 : 0.65,
        candidate.fallbackValidationIssues.length ? 0.35 : 1
      );

  const combinedFlags = dedupeValidationFlags([...fallbackFlags, ...validationFlags]);

  return {
    foodName: candidate.foodName,
    quantityDescription: candidate.quantityDescription,
    estimatedGrams,
    confidence,
    sourceKind: dbMatch?.sourceKind ?? 'ai_fallback',
    sourceLabel,
    matchMode: dbMatch?.matchMode ?? 'ai_fallback',
    sourceStatus: dbMatch?.sourceStatus ?? 'published',
    amountBasisG: dbMatch?.amountBasisG ?? 100,
    validationFlags: dedupeValidationFlags(
      confidence < 0.65 ? [...combinedFlags, 'low_confidence'] : combinedFlags
    ),
    per100g,
    totals: scaleNutritionProfile(per100g, estimatedGrams),
  };
}

async function resolveCandidate(candidate: AiParsedFoodItem): Promise<ResolvedFoodItem[]> {
  const normalizedCandidate = sanitizeCandidate(candidate);
  const exactMatch = await lookupNutritionByNameExact(normalizedCandidate.foodName);
  const fuzzyMatch = exactMatch
    ? null
    : await lookupNutritionByNameFuzzy(normalizedCandidate.foodName);
  const dbMatch = exactMatch ?? fuzzyMatch;
  if (!dbMatch) {
    await recordLookupMiss(normalizedCandidate.foodName);
  }
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

  const candidate = extractSingleFoodCandidate(description);
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

  return foods.map((item) => {
    const nextGrams = Math.max(
      1,
      Math.round((item.estimatedGrams / currentTotalWeight) * totalWeight)
    );
    return {
      ...item,
      estimatedGrams: nextGrams,
      validationFlags: dedupeValidationFlags([
        ...item.validationFlags,
        'composite_total_rebalanced',
      ]),
      totals: scaleNutritionProfile(item.per100g, nextGrams),
    };
  });
}

function computeCoreDeltaRatio(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(a, b, 1);
}

function alignComponentsToWholeDish(
  foods: ParseFoodDescriptionOutput,
  wholeDishTotals: ResolvedFoodItem['totals']
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
        acc[key] = Number(
          Math.max(wholeDishTotals[key] - preservedTotals[key], 0).toFixed(1)
        );
        return acc;
      },
      {} as Record<NutritionFieldKey, number>
    )
  );

  const lockedMacroOverflow = ['energyKcal', 'proteinGrams', 'carbohydrateGrams', 'fatGrams']
    .some((key) => preservedTotals[key as keyof NutritionProfile23] > wholeDishTotals[key as keyof NutritionProfile23] + 5);
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
          const denominator = estimatedTotals[key];
          const share =
            denominator > 0
              ? item.totals[key] / denominator
              : estimatedWeight > 0
                ? item.estimatedGrams / estimatedWeight
                : 1 / estimatedFoods.length;
          acc[key] = Number((remainingTotals[key] * share).toFixed(1));
          return acc;
        },
        {} as Record<NutritionFieldKey, number>
      )
    );

    return {
      ...item,
      per100g: convertTotalsToPer100g(alignedTotals, item.estimatedGrams),
      totals: alignedTotals,
      validationFlags: dedupeValidationFlags([
        ...item.validationFlags,
        'whole_dish_component_aligned',
      ]),
    };
  });
}

async function maybeOverrideWithWholeDish(
  description: string,
  foods: ParseFoodDescriptionOutput
): Promise<ParseFoodDescriptionOutput> {
  const candidate = extractSingleFoodCandidate(description);
  if (!candidate?.foodName) {
    return foods;
  }

  const exactWholeDish = await lookupNutritionByNameExact(candidate.foodName);
  if (!exactWholeDish) {
    return foods;
  }

  const estimated = await estimateGrams(
    candidate.foodName,
    candidate.quantityDescription,
    exactWholeDish.matchedName
  );
  const wholeDishPer100g = applyPreparationNutritionAdjustments(
    exactWholeDish.per100g,
    candidate.foodName,
    exactWholeDish.matchedName
  );
  const wholeDishTotals = scaleNutritionProfile(wholeDishPer100g, estimated.grams);
  const decomposedTotals = sumNutritionProfiles(foods.map((item) => item.totals));

  const energyDelta = computeCoreDeltaRatio(
    wholeDishTotals.energyKcal,
    decomposedTotals.energyKcal
  );
  const proteinDelta = computeCoreDeltaRatio(
    wholeDishTotals.proteinGrams,
    decomposedTotals.proteinGrams
  );
  const carbohydrateDelta = computeCoreDeltaRatio(
    wholeDishTotals.carbohydrateGrams,
    decomposedTotals.carbohydrateGrams
  );
  const fatDelta = computeCoreDeltaRatio(wholeDishTotals.fatGrams, decomposedTotals.fatGrams);

  if (
    energyDelta <= 0.15 &&
    proteinDelta <= 0.2 &&
    carbohydrateDelta <= 0.2 &&
    fatDelta <= 0.2
  ) {
    return alignComponentsToWholeDish(foods, wholeDishTotals);
  }

  return [
    {
      foodName: exactWholeDish.matchedName,
      quantityDescription: candidate.quantityDescription,
      estimatedGrams: estimated.grams,
      confidence: 0.92,
      sourceKind: exactWholeDish.sourceKind,
      sourceLabel: exactWholeDish.sourceLabel,
      matchMode: exactWholeDish.matchMode,
      sourceStatus: exactWholeDish.sourceStatus,
      amountBasisG: exactWholeDish.amountBasisG,
      validationFlags: dedupeValidationFlags([
        ...exactWholeDish.validationFlags,
        ...estimated.validationFlags,
        'whole_dish_db_override',
      ]),
      per100g: wholeDishPer100g,
      totals: wholeDishTotals,
    },
  ];
}

async function resolveDescriptionSegment(
  description: string
): Promise<ParseFoodDescriptionOutput> {
  const directlyResolvedFoods = await tryResolveDirectDescription(description);
  if (directlyResolvedFoods?.length) {
    return directlyResolvedFoods;
  }

  const singleCandidate = extractSingleFoodCandidate(description);
  const exactWholeDish =
    singleCandidate?.foodName && COMPOSITE_FOOD_PATTERN.test(singleCandidate.foodName)
      ? await lookupNutritionByNameExact(singleCandidate.foodName)
      : null;

  const candidates = await parseFoodCandidatesWithGemini(description);
  const resolvedFoods = (await Promise.all(candidates.map(resolveCandidate))).flat();
  const targetTotalWeight = await determineTargetTotalWeight(description, resolvedFoods);
  const rebalancedFoods = rebalanceResolvedFoods(resolvedFoods, targetTotalWeight);
  return singleCandidate?.foodName &&
    COMPOSITE_FOOD_PATTERN.test(singleCandidate.foodName) &&
    !exactWholeDish
    ? rebalancedFoods
    : maybeOverrideWithWholeDish(description, rebalancedFoods);
}

export async function parseFoodDescription(
  input: ParseFoodDescriptionInput
): Promise<ParseFoodDescriptionOutput> {
  const parsedInput = ParseFoodDescriptionInputSchema.parse(input);
  const directlyResolvedFoods = await tryResolveDirectDescription(parsedInput.description);
  if (directlyResolvedFoods?.length) {
    return ParseFoodDescriptionOutputSchema.parse(directlyResolvedFoods);
  }

  const segments = splitFoodDescriptionSegments(parsedInput.description);
  if (segments.length > 1) {
    const segmentResults = await Promise.all(
      segments.map((segment) => resolveDescriptionSegment(segment))
    );
    return ParseFoodDescriptionOutputSchema.parse(segmentResults.flat());
  }

  const resolvedFoods = await resolveDescriptionSegment(parsedInput.description);
  return ParseFoodDescriptionOutputSchema.parse(resolvedFoods);
}
