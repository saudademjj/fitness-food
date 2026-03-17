import type {ParseFoodDescriptionOutput} from '@/lib/food-contract';
import {
  COMPOSITE_FOOD_PATTERN,
  extractMultiFoodCandidates,
  extractSingleFoodCandidate,
  sanitizeFoodName,
} from '@/lib/food-text';
import {cloneNutritionProfileMeta, scaleNutritionProfile} from '@/lib/nutrition-profile';
import {estimateGrams, applyPreparationNutritionAdjustments} from '@/lib/portion-reference';
import {
  createNutritionLookupResolver,
  type NutritionLookupResolver,
} from '@/lib/nutrition-db';
import {dedupeValidationFlags} from '@/lib/validation';

export async function tryResolveDirectDescription(
  description: string,
  lookupResolver: NutritionLookupResolver = createNutritionLookupResolver()
): Promise<ParseFoodDescriptionOutput | null> {
  const multiCandidates = extractMultiFoodCandidates(description);
  if (multiCandidates?.length) {
    const resolvedFoods = await Promise.all(
      multiCandidates.map(async (candidate) => {
        const dbMatch = await lookupResolver(candidate.foodName, {
          allowFuzzy: !COMPOSITE_FOOD_PATTERN.test(candidate.foodName),
        });
        if (!dbMatch) {
          return null;
        }

        const estimated = await estimateGrams(
          candidate.foodName,
          candidate.quantityDescription,
          dbMatch.matchedName
        );
        const adjusted = applyPreparationNutritionAdjustments(
          dbMatch.per100g,
          dbMatch.per100gMeta,
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
          per100g: adjusted.profile,
          per100gMeta: adjusted.meta,
          totals: scaleNutritionProfile(adjusted.profile, estimated.grams),
          totalsMeta: cloneNutritionProfileMeta(adjusted.meta),
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

  const dbMatch = await lookupResolver(foodName, {
    allowFuzzy: true,
  });
  if (!dbMatch) {
    return null;
  }

  const estimated = await estimateGrams(foodName, candidate.quantityDescription, dbMatch.matchedName);
  const adjusted = applyPreparationNutritionAdjustments(
    dbMatch.per100g,
    dbMatch.per100gMeta,
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
      per100g: adjusted.profile,
      per100gMeta: adjusted.meta,
      totals: scaleNutritionProfile(adjusted.profile, estimated.grams),
      totalsMeta: cloneNutritionProfileMeta(adjusted.meta),
    },
  ];
}
