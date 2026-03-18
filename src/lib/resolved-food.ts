import type {ResolvedFoodItem, ValidationFlag} from '@/lib/food-contract';
import {
  cloneNutritionProfileMeta,
  createNutritionProfile,
  createNutritionProfileMeta,
  scaleNutritionProfile,
  NON_CORE_NUTRITION_KEYS,
  type NutritionProfile23,
  type NutritionProfileMeta23,
} from '@/lib/nutrition-profile';
import type {NutritionLookupResult} from '@/lib/nutrition-db';
import {applyPreparationNutritionAdjustments} from '@/lib/portion-reference';
import {dedupeValidationFlags} from '@/lib/validation';

export function createMacroOnlyAiProfile(profile: NutritionProfile23): NutritionProfile23 {
  return createNutritionProfile({
    energyKcal: profile.energyKcal,
    proteinGrams: profile.proteinGrams,
    carbohydrateGrams: profile.carbohydrateGrams,
    fatGrams: profile.fatGrams,
  });
}

export function createMacroOnlyAiMeta(meta?: NutritionProfileMeta23): NutritionProfileMeta23 {
  const nextMeta = createNutritionProfileMeta(undefined, {
    status: 'missing',
    source: 'ai',
  });

  for (const key of ['energyKcal', 'proteinGrams', 'carbohydrateGrams', 'fatGrams'] as const) {
    nextMeta[key] = meta?.[key] ?? {
      status: 'estimated',
      source: 'ai',
    };
  }

  return nextMeta;
}

function summarizeMissingNutrition(meta: NutritionProfileMeta23) {
  return NON_CORE_NUTRITION_KEYS.filter((key) => meta[key].status === 'missing');
}

type BuildResolvedFoodOptions = {
  foodName: string;
  quantityDescription: string;
  estimatedGrams: number;
  confidence: number;
  dbMatch: NutritionLookupResult | null;
  fallbackPer100g: NutritionProfile23;
  fallbackPer100gMeta?: NutritionProfileMeta23 | null;
  validationFlags?: ValidationFlag[];
  fallbackValidationFlags?: ValidationFlag[];
  fallbackSourceLabel?: string;
  fallbackConfidenceCap?: number;
};

export function buildResolvedFood({
  foodName,
  quantityDescription,
  estimatedGrams,
  confidence,
  dbMatch,
  fallbackPer100g,
  fallbackPer100gMeta,
  validationFlags = [],
  fallbackValidationFlags = ['ai_macro_estimate', 'db_lookup_miss'],
  fallbackSourceLabel = 'AI 宏量估算',
  fallbackConfidenceCap = 0.62,
}: BuildResolvedFoodOptions): ResolvedFoodItem {
  const fallbackMeta = createMacroOnlyAiMeta(fallbackPer100gMeta ?? undefined);
  const fallbackPreparation = applyPreparationNutritionAdjustments(
    createMacroOnlyAiProfile(fallbackPer100g),
    fallbackMeta,
    foodName
  );

  let per100g = fallbackPreparation.profile;
  let per100gMeta = fallbackPreparation.meta;
  let sourceLabel = fallbackSourceLabel;
  let itemConfidence = Math.min(confidence, fallbackConfidenceCap);
  let baselineFlags = [...fallbackValidationFlags];

  if (dbMatch) {
    const prepared = applyPreparationNutritionAdjustments(
      dbMatch.per100g,
      dbMatch.per100gMeta,
      foodName,
      dbMatch.matchedName
    );
    per100g = prepared.profile;
    per100gMeta = prepared.meta;
    sourceLabel = dbMatch.sourceLabel;
    itemConfidence = Math.min(confidence, dbMatch.matchMode === 'exact' ? 0.92 : 0.82);
    baselineFlags = [...dbMatch.validationFlags];
  }

  const missingFields = summarizeMissingNutrition(per100gMeta);
  if (missingFields.length > 0) {
    baselineFlags.push('nutrition_partial', 'nutrition_unknown');
  }

  const combinedFlags = dedupeValidationFlags([
    ...baselineFlags,
    ...validationFlags,
    ...(itemConfidence < 0.65 ? (['low_confidence'] as const) : []),
  ]);

  return {
    foodName,
    quantityDescription,
    estimatedGrams,
    confidence: itemConfidence,
    sourceKind: dbMatch?.sourceKind ?? 'ai_fallback',
    sourceLabel,
    matchMode: dbMatch?.matchMode ?? 'ai_fallback',
    sourceStatus: dbMatch?.sourceStatus ?? 'published',
    amountBasisG: dbMatch?.amountBasisG ?? 100,
    validationFlags: combinedFlags,
    per100g,
    per100gMeta,
    totals: scaleNutritionProfile(per100g, estimatedGrams),
    totalsMeta: cloneNutritionProfileMeta(per100gMeta),
  };
}
