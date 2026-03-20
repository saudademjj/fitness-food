import {parseFoodDescription} from '@/ai/flows/parse-food-description-flow';
import type {FoodLogEntry} from '@/components/macro-calculator/types';
import type {ResolvedFoodItem, ResolvedFoodItems} from '@/lib/food-contract';
import {isCompositeFoodName, sanitizeFoodName} from '@/lib/food-text';
import {
  createNutritionLookupResolver,
  type NutritionLookupResolver,
  type NutritionLookupResult,
} from '@/lib/nutrition-db';
import {applyPreparationNutritionAdjustments} from '@/lib/portion-reference';
import {cloneNutritionProfileMeta, scaleNutritionProfile} from '@/lib/nutrition-profile';
import {dedupeValidationFlags} from '@/lib/validation';

const RETAINED_EDIT_VALIDATION_FLAGS = [
  'portion_reference_applied',
  'portion_keyword_applied',
  'portion_fallback_applied',
  'portion_size_adjusted',
  'portion_preparation_adjusted',
] as const;

type ParsedFoodDescription = Awaited<ReturnType<typeof parseFoodDescription>>;

function applyEditedWeight(
  food: ResolvedFoodItem,
  targetGrams: number
): ResolvedFoodItem {
  return {
    ...food,
    estimatedGrams: targetGrams,
    totals: scaleNutritionProfile(food.per100g, targetGrams),
    totalsMeta: cloneNutritionProfileMeta(food.per100gMeta),
  };
}

function retainEditValidationFlags(
  flags: ResolvedFoodItem['validationFlags']
): ResolvedFoodItem['validationFlags'] {
  return flags.filter((flag) =>
    RETAINED_EDIT_VALIDATION_FLAGS.includes(
      flag as (typeof RETAINED_EDIT_VALIDATION_FLAGS)[number]
    )
  );
}

function buildResolvedEditedFood(
  food: ResolvedFoodItem,
  dbMatch: NutritionLookupResult
): ResolvedFoodItem {
  const adjusted = applyPreparationNutritionAdjustments(
    dbMatch.per100g,
    dbMatch.per100gMeta,
    food.foodName,
    dbMatch.matchedName
  );
  const confidence = dbMatch.matchMode === 'exact' ? 0.92 : 0.82;

  return {
    ...food,
    confidence,
    sourceKind: dbMatch.sourceKind,
    sourceLabel: dbMatch.sourceLabel,
    matchMode: dbMatch.matchMode,
    sourceStatus: dbMatch.sourceStatus,
    amountBasisG: dbMatch.amountBasisG,
    validationFlags: dedupeValidationFlags([
      ...dbMatch.validationFlags,
      ...retainEditValidationFlags(food.validationFlags),
      ...(confidence < 0.65 ? (['low_confidence'] as const) : []),
    ]),
    per100g: adjusted.profile,
    per100gMeta: adjusted.meta,
    totals: scaleNutritionProfile(adjusted.profile, food.estimatedGrams),
    totalsMeta: cloneNutritionProfileMeta(adjusted.meta),
  };
}

function pickBestParsedFoodCandidate(
  foodName: string,
  parsed: ParsedFoodDescription
): ResolvedFoodItem | null {
  if (!parsed.items.length) {
    return null;
  }

  return (
    parsed.items.find((candidate) => candidate.foodName === foodName) ??
    parsed.items.find(
      (candidate) =>
        candidate.foodName.includes(foodName) || foodName.includes(candidate.foodName)
    ) ??
    parsed.items[0] ??
    null
  );
}

async function parseCandidateFromDescriptions(
  descriptions: string[],
  foodName: string
): Promise<ResolvedFoodItem | null> {
  for (const description of descriptions) {
    const parsed = await parseFoodDescription({description});
    const candidate = pickBestParsedFoodCandidate(foodName, parsed);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

async function resolveEditedFood(
  food: ResolvedFoodItem,
  lookupResolver: NutritionLookupResolver
): Promise<ResolvedFoodItem> {
  const sanitizedName = sanitizeFoodName(food.foodName);
  if (!sanitizedName) {
    return food;
  }

  const normalizedFood = {
    ...food,
    foodName: sanitizedName,
  };
  const dbMatch = await lookupResolver(sanitizedName, {
    allowFuzzy: !isCompositeFoodName(sanitizedName),
    recordMiss: true,
  });
  if (dbMatch) {
    return buildResolvedEditedFood(normalizedFood, dbMatch);
  }

  const reparsedFood = await parseCandidateFromDescriptions([sanitizedName], sanitizedName);
  if (!reparsedFood) {
    return {
      ...normalizedFood,
      validationFlags: dedupeValidationFlags([
        ...retainEditValidationFlags(food.validationFlags),
        'db_lookup_miss',
        'low_confidence',
      ]),
    };
  }

  return {
    ...applyEditedWeight(reparsedFood, food.estimatedGrams),
    foodName: sanitizedName,
    quantityDescription: food.quantityDescription,
    validationFlags: dedupeValidationFlags([
      ...reparsedFood.validationFlags,
      ...retainEditValidationFlags(food.validationFlags),
    ]),
  };
}

function buildMigrationRefreshDescriptions(entry: FoodLogEntry): string[] {
  const descriptions = [
    entry.quantityDescription && entry.quantityDescription !== '未知'
      ? `${entry.quantityDescription}${entry.foodName}`
      : null,
    entry.foodName,
  ].filter((description): description is string => Boolean(description));

  return [...new Set(descriptions)];
}

async function refreshEntryForMigration(entry: FoodLogEntry): Promise<FoodLogEntry> {
  try {
    const refreshed = await parseCandidateFromDescriptions(
      buildMigrationRefreshDescriptions(entry),
      entry.foodName
    );
    if (!refreshed) {
      throw new Error('No migration candidate');
    }

    return {
      ...entry,
      ...applyEditedWeight(refreshed, entry.estimatedGrams),
      validationFlags: dedupeValidationFlags(refreshed.validationFlags),
    };
  } catch {
    return {
      ...entry,
      validationFlags: dedupeValidationFlags([
        ...entry.validationFlags,
        'ai_macro_unverified',
        'low_confidence',
      ]),
    };
  }
}

export async function resolveEditedFoods(
  foods: ResolvedFoodItems
): Promise<ResolvedFoodItems> {
  const lookupResolver = createNutritionLookupResolver();
  return Promise.all(foods.map((food) => resolveEditedFood(food, lookupResolver)));
}

export async function refreshEntriesForMigration(
  entries: FoodLogEntry[]
): Promise<FoodLogEntry[]> {
  return Promise.all(entries.map((entry) => refreshEntryForMigration(entry)));
}
