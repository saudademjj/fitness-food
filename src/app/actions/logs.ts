'use server';

import type {FoodLogEntry} from '@/components/macro-calculator/types';
import {parseFoodDescription} from '@/ai/flows/parse-food-description-flow';
import type {ParseFoodDescriptionOutput, ResolvedFoodItem, ResolvedFoodItems} from '@/lib/food-contract';
import {isCompositeFoodName, sanitizeFoodName} from '@/lib/food-text';
import {
  createNutritionLookupResolver,
  type NutritionLookupResolver,
  type NutritionLookupResult,
} from '@/lib/nutrition-db';
import {applyPreparationNutritionAdjustments} from '@/lib/portion-reference';
import {cloneNutritionProfileMeta, scaleNutritionProfile} from '@/lib/nutrition-profile';
import {dedupeValidationFlags} from '@/lib/validation';
import {
  createFoodLog,
  deleteFoodLogItem,
  exportFoodLogs,
  listFoodLogEntries,
  migrateLocalDraftEntries,
  updateFoodLogItem,
} from '@/lib/food-log-db';
import {applySecondaryReviewToOutput, buildParseOutputFromFoods} from '@/lib/secondary-review';
import {requireViewer} from '@/lib/auth';

export async function listFoodLogEntriesAction(date?: string): Promise<FoodLogEntry[]> {
  const viewer = await requireViewer();
  return listFoodLogEntries(viewer.id, date);
}

export async function saveParsedFoodsAction(
  foods: ResolvedFoodItems,
  sourceDescription?: string | null,
  eatenAt?: number,
  eatenOn?: string
): Promise<FoodLogEntry[]> {
  const viewer = await requireViewer();
  return createFoodLog(viewer.id, foods, sourceDescription, eatenAt, eatenOn);
}

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

const RETAINED_EDIT_VALIDATION_FLAGS = [
  'portion_reference_applied',
  'portion_keyword_applied',
  'portion_fallback_applied',
  'portion_size_adjusted',
  'portion_preparation_adjusted',
] as const;

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

function pickEditedFallbackCandidate(
  foodName: string,
  parsed: ReturnType<typeof parseFoodDescription> extends Promise<infer T> ? T : never
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

  const reparsedFoods = await parseFoodDescription({description: sanitizedName});
  const reparsedFood = pickEditedFallbackCandidate(sanitizedName, reparsedFoods);
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

function buildMigrationRefreshDescription(entry: FoodLogEntry): string {
  return entry.quantityDescription && entry.quantityDescription !== '未知'
    ? `${entry.quantityDescription}${entry.foodName}`
    : entry.foodName;
}

function pickMigrationCandidate(
  entry: FoodLogEntry,
  parsed: ReturnType<typeof parseFoodDescription> extends Promise<infer T> ? T : never
): ResolvedFoodItem | null {
  if (!parsed.items.length) {
    return null;
  }

  return (
    parsed.items.find((food) => food.foodName === entry.foodName) ??
    parsed.items.find(
      (food) =>
        food.foodName.includes(entry.foodName) || entry.foodName.includes(food.foodName)
    ) ??
    parsed.items[0] ??
    null
  );
}

async function refreshEntryForMigration(
  entry: FoodLogEntry
): Promise<FoodLogEntry> {
  const descriptionsToTry = [buildMigrationRefreshDescription(entry), entry.foodName].filter(
    Boolean
  );

  try {
    for (const description of descriptionsToTry) {
      const parsed = await parseFoodDescription({description});
      const refreshed = pickMigrationCandidate(entry, parsed);
      if (!refreshed) {
        continue;
      }

      return {
        ...entry,
        ...applyEditedWeight(refreshed, entry.estimatedGrams),
        validationFlags: dedupeValidationFlags(refreshed.validationFlags),
      };
    }
  } catch {}

  return {
    ...entry,
    validationFlags: dedupeValidationFlags([
      ...entry.validationFlags,
      'ai_macro_unverified',
      'low_confidence',
    ]),
  };
}

export async function reviewEditedFoodsAction(
  foods: ResolvedFoodItems,
  sourceDescription?: string | null
): Promise<ParseFoodDescriptionOutput> {
  const lookupResolver = createNutritionLookupResolver();
  const resolvedFoods = await Promise.all(foods.map((food) => resolveEditedFood(food, lookupResolver)));
  const baseOutput = buildParseOutputFromFoods(resolvedFoods, sourceDescription);
  const reviewed = await applySecondaryReviewToOutput({
    sourceDescription:
      sourceDescription?.trim() || resolvedFoods[0]?.foodName || '已编辑食物',
    output: baseOutput,
    lockExplicitMetricWeights: false,
  });

  return reviewed.output;
}

export async function updateFoodLogItemAction(
  itemId: string,
  food: ResolvedFoodItem
): Promise<FoodLogEntry> {
  const viewer = await requireViewer();
  return updateFoodLogItem(viewer.id, itemId, food);
}

export async function deleteFoodLogItemAction(itemId: string): Promise<void> {
  const viewer = await requireViewer();
  await deleteFoodLogItem(viewer.id, itemId);
}

export async function exportFoodLogsAction(
  format: 'csv' | 'json',
  date?: string
): Promise<{filename: string; mimeType: string; content: string}> {
  const viewer = await requireViewer();
  return exportFoodLogs(viewer.id, format, date);
}

export async function migrateLocalEntriesAction(entries: FoodLogEntry[]): Promise<number> {
  const viewer = await requireViewer();
  const refreshedEntries = await Promise.all(entries.map((entry) => refreshEntryForMigration(entry)));

  return migrateLocalDraftEntries(viewer.id, refreshedEntries);
}
