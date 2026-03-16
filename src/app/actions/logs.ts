'use server';

import type {FoodLogEntry} from '@/components/macro-calculator/types';
import {parseFoodDescription} from '@/ai/flows/parse-food-description-flow';
import type {ParseFoodDescriptionOutput} from '@/lib/food-contract';
import {scaleNutritionProfile} from '@/lib/nutrition-profile';
import {
  createFoodLog,
  deleteFoodLogItem,
  exportFoodLogs,
  listFoodLogEntries,
  migrateLocalDraftEntries,
  updateFoodLogItem,
} from '@/lib/food-log-db';
import {requireViewer} from '@/lib/auth';

export async function listFoodLogEntriesAction(date?: string): Promise<FoodLogEntry[]> {
  const viewer = await requireViewer();
  return listFoodLogEntries(viewer.id, date);
}

export async function saveParsedFoodsAction(
  foods: ParseFoodDescriptionOutput,
  sourceDescription?: string | null
): Promise<FoodLogEntry[]> {
  const viewer = await requireViewer();
  return createFoodLog(viewer.id, foods, sourceDescription);
}

function applyEditedWeight(
  food: ParseFoodDescriptionOutput[number],
  targetGrams: number
): ParseFoodDescriptionOutput[number] {
  return {
    ...food,
    estimatedGrams: targetGrams,
    totals: scaleNutritionProfile(food.per100g, targetGrams),
  };
}

export async function resolveEditedFoodsAction(
  foods: ParseFoodDescriptionOutput
): Promise<ParseFoodDescriptionOutput> {
  const rebuiltFoods: ParseFoodDescriptionOutput = [];

  for (const food of foods) {
    const parsed = await parseFoodDescription({description: food.foodName});
    const resolved = parsed[0];
    if (!resolved) {
      rebuiltFoods.push(food);
      continue;
    }

    rebuiltFoods.push(applyEditedWeight(resolved, food.estimatedGrams));
  }

  return rebuiltFoods;
}

export async function updateFoodLogItemAction(
  itemId: string,
  food: ParseFoodDescriptionOutput[number]
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
  const refreshedEntries = await Promise.all(
    entries.map(async (entry) => {
      const refreshed = await parseFoodDescription({description: entry.foodName});
      const latest = refreshed[0];
      if (!latest) {
        return entry;
      }

      return {
        ...entry,
        ...applyEditedWeight(latest, entry.estimatedGrams),
      };
    })
  );

  return migrateLocalDraftEntries(viewer.id, refreshedEntries);
}
