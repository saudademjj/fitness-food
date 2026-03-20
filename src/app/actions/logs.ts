'use server';

import type {FoodLogEntry} from '@/components/macro-calculator/types';
import type {
  ParseFoodDescriptionOutput,
  ResolvedFoodItem,
  ResolvedFoodItems,
} from '@/lib/food-contract';
import {
  createFoodLog,
  deleteFoodLogItem,
  exportFoodLogs,
  listFoodLogEntries,
  migrateLocalDraftEntries,
  updateFoodLogItem,
} from '@/lib/food-log-db';
import {
  refreshEntriesForMigration,
  resolveEditedFoods,
} from '@/lib/food-log-refresh';
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

export async function reviewEditedFoodsAction(
  foods: ResolvedFoodItems,
  sourceDescription?: string | null
): Promise<ParseFoodDescriptionOutput> {
  let resolvedFoods: ResolvedFoodItems;
  try {
    resolvedFoods = await resolveEditedFoods(foods);
  } catch {
    resolvedFoods = foods;
  }

  const baseOutput = buildParseOutputFromFoods(resolvedFoods, sourceDescription);

  try {
    const reviewed = await applySecondaryReviewToOutput({
      sourceDescription:
        sourceDescription?.trim() || resolvedFoods[0]?.foodName || '已编辑食物',
      output: baseOutput,
      lockExplicitMetricWeights: false,
    });

    return reviewed.output;
  } catch {
    return baseOutput;
  }
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
  const refreshedEntries = await refreshEntriesForMigration(entries);

  return migrateLocalDraftEntries(viewer.id, refreshedEntries);
}
