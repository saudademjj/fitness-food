import type {AiParsedFoodItem, ResolvedFoodItems} from '@/lib/food-contract';
import {
  extractSingleFoodCandidate,
  extractWholeDishCandidate,
  parseQuantity,
  sanitizeFoodName,
} from '@/lib/food-text';
import {
  createNutritionProfile,
  type NutritionFieldKey,
} from '@/lib/nutrition-profile';
import {estimateGrams} from '@/lib/portion-reference';
import type {WeightResolutionTrace} from '@/lib/runtime-observability';
import {dedupeValidationFlags} from '@/lib/validation';

export type WeightedResolution = {
  estimatedGrams: number;
  validationFlags: ResolvedFoodItems[number]['validationFlags'];
  trace: WeightResolutionTrace;
};

export function sanitizeCandidate(candidate: AiParsedFoodItem): AiParsedFoodItem {
  return {
    ...candidate,
    foodName: sanitizeFoodName(candidate.foodName),
    quantityDescription: candidate.quantityDescription.trim() || '未知',
  };
}

export async function chooseEstimatedGrams(
  candidate: AiParsedFoodItem,
  matchedName?: string | null
): Promise<WeightedResolution> {
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
  const baseTrace = {
    foodName: candidate.foodName,
    quantityDescription: candidate.quantityDescription,
    portionMatchStrategy:
      estimated.portion?.matchStrategy ?? ('none' as const),
    aiEstimatedGrams: hasCandidateEstimate ? candidate.estimatedGrams : null,
    portionEstimatedGrams: estimated.grams,
    matchedName: matchedName ?? null,
  };

  if (hasExplicitMetricUnit) {
    return {
      estimatedGrams: estimated.grams,
      validationFlags: estimated.validationFlags,
      trace: {
        ...baseTrace,
        strategy: 'explicit_metric',
        finalEstimatedGrams: estimated.grams,
      },
    };
  }

  if (portionMatchStrategy === 'exact') {
    return {
      estimatedGrams: estimated.grams,
      validationFlags: estimated.validationFlags,
      trace: {
        ...baseTrace,
        strategy: 'portion_exact',
        finalEstimatedGrams: estimated.grams,
      },
    };
  }

  if (hasHighConfidenceCandidateEstimate && portionMatchStrategy === 'keyword') {
    const delta =
      Math.abs(candidate.estimatedGrams - estimated.grams) /
      Math.max(candidate.estimatedGrams, estimated.grams, 1);
    const estimatedPreferred =
      delta <= 0.3 || estimated.confidenceScore >= 0.85;
    const finalEstimatedGrams = estimatedPreferred
      ? estimated.grams
      : candidate.estimatedGrams;

    return {
      estimatedGrams: finalEstimatedGrams,
      validationFlags: estimated.validationFlags,
      trace: {
        ...baseTrace,
        strategy: estimatedPreferred
          ? 'portion_keyword_preferred'
          : 'portion_keyword_ai_preferred',
        finalEstimatedGrams,
      },
    };
  }

  if (hasHighConfidenceCandidateEstimate && portionMatchStrategy === 'fallback') {
    const delta =
      Math.abs(candidate.estimatedGrams - estimated.grams) /
      Math.max(candidate.estimatedGrams, estimated.grams, 1);
    const aiPreferred = delta <= 0.35 || candidate.confidence >= 0.9;
    const finalEstimatedGrams = aiPreferred
      ? candidate.estimatedGrams
      : estimated.grams;

    return {
      estimatedGrams: finalEstimatedGrams,
      validationFlags: estimated.validationFlags,
      trace: {
        ...baseTrace,
        strategy: aiPreferred
          ? 'portion_fallback_ai_preferred'
          : 'portion_fallback_preferred',
        finalEstimatedGrams,
      },
    };
  }

  return {
    estimatedGrams: estimated.grams,
    validationFlags: estimated.validationFlags,
    trace: {
      ...baseTrace,
      strategy: 'portion_default',
      finalEstimatedGrams: estimated.grams,
    },
  };
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

export async function determineTargetTotalWeight(
  description: string,
  foods: ResolvedFoodItems
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

export function rebalanceResolvedFoods(
  foods: ResolvedFoodItems,
  totalWeight: number | null
): ResolvedFoodItems {
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
      totals: createNutritionProfile(
        Object.keys(item.totals).reduce((acc, key) => {
          const typedKey = key as NutritionFieldKey;
          acc[typedKey] =
            item.per100g[typedKey] === null
              ? null
              : Number(((item.per100g[typedKey] ?? 0) * nextGrams / 100).toFixed(1));
          return acc;
        }, {} as Partial<typeof item.totals>)
      ),
      totalsMeta: item.totalsMeta,
    };
  });
}
