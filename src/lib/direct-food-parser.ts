import type {ParseFoodDescriptionOutput} from '@/lib/food-contract';
import {
  COMPOSITE_FOOD_PATTERN,
  extractMultiFoodCandidates,
  extractSingleFoodCandidate,
  sanitizeFoodName,
} from '@/lib/food-text';
import {scaleNutritionProfile} from '@/lib/nutrition-profile';
import {estimateGrams} from '@/lib/portion-reference';
import {
  lookupNutritionByNameExact,
  lookupNutritionByNameFuzzy,
} from '@/lib/nutrition-db';
import {applyPreparationNutritionAdjustments} from '@/lib/portion-reference';
import {dedupeValidationFlags} from '@/lib/validation';

export async function tryResolveDirectDescription(
  description: string
): Promise<ParseFoodDescriptionOutput | null> {
  const multiCandidates = extractMultiFoodCandidates(description);
  if (multiCandidates?.length) {
    const resolvedFoods = await Promise.all(
      multiCandidates.map(async (candidate) => {
        const exactMatch = await lookupNutritionByNameExact(candidate.foodName);
        const fuzzyMatch =
          exactMatch || COMPOSITE_FOOD_PATTERN.test(candidate.foodName)
            ? null
            : await lookupNutritionByNameFuzzy(candidate.foodName);
        const dbMatch = exactMatch ?? fuzzyMatch;
        if (!dbMatch) {
          return null;
        }

        const estimated = await estimateGrams(
          candidate.foodName,
          candidate.quantityDescription,
          dbMatch.matchedName
        );
        const per100g = applyPreparationNutritionAdjustments(
          dbMatch.per100g,
          candidate.foodName,
          dbMatch.matchedName
        );

        return {
          foodName: candidate.foodName,
          quantityDescription: candidate.quantityDescription,
          estimatedGrams: estimated.grams,
          confidence: 0.9,
          sourceKind: dbMatch.sourceKind,
          sourceLabel: dbMatch.sourceLabel,
          matchMode: dbMatch.matchMode,
          sourceStatus: dbMatch.sourceStatus,
          amountBasisG: dbMatch.amountBasisG,
          validationFlags: dedupeValidationFlags([
            ...dbMatch.validationFlags,
            ...estimated.validationFlags,
          ]),
          per100g,
          totals: scaleNutritionProfile(per100g, estimated.grams),
        };
      })
    );

    return resolvedFoods.every(Boolean)
      ? (resolvedFoods as ParseFoodDescriptionOutput)
      : null;
  }

  const candidate = extractSingleFoodCandidate(description);
  if (!candidate) {
    return null;
  }

  const foodName = sanitizeFoodName(candidate.foodName);
  if (!foodName) {
    return null;
  }

  const exactMatch = await lookupNutritionByNameExact(foodName);
  const fuzzyMatch =
    exactMatch || COMPOSITE_FOOD_PATTERN.test(foodName)
      ? null
      : await lookupNutritionByNameFuzzy(foodName);
  const dbMatch = exactMatch ?? fuzzyMatch;
  if (!dbMatch) {
    return null;
  }

  const estimated = await estimateGrams(foodName, candidate.quantityDescription, dbMatch.matchedName);
  const per100g = applyPreparationNutritionAdjustments(
    dbMatch.per100g,
    foodName,
    dbMatch.matchedName
  );

  return [
    {
      foodName,
      quantityDescription: candidate.quantityDescription,
      estimatedGrams: estimated.grams,
      confidence: candidate.quantityDescription === '未知' ? 0.84 : 0.96,
      sourceKind: dbMatch.sourceKind,
      sourceLabel: dbMatch.sourceLabel,
      matchMode: dbMatch.matchMode,
      sourceStatus: dbMatch.sourceStatus,
      amountBasisG: dbMatch.amountBasisG,
      validationFlags: dedupeValidationFlags([
        ...dbMatch.validationFlags,
        ...estimated.validationFlags,
      ]),
      per100g,
      totals: scaleNutritionProfile(per100g, estimated.grams),
    },
  ];
}
