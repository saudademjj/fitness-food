
import type {ParseFoodDescriptionOutput} from '@/lib/food-contract';
import {scaleMacros, sumMacros, type MacroNutrients} from '@/lib/macros';

export type FoodLogEntry = ParseFoodDescriptionOutput[number] & {
  id: string;
  timestamp: number;
};

export interface MacroGoals extends MacroNutrients {}

export const DEFAULT_GOALS: MacroGoals = {
  energyKcal: 2000,
  proteinGrams: 120,
  fatGrams: 65,
  carbohydrateGrams: 225,
};

export const ENTRY_STORAGE_KEY = 'macro_helper_entries_v3';
export const GOAL_STORAGE_KEY = 'macro_helper_goals_v3';

export function createEntryId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `entry_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function updateFoodWeight<T extends ParseFoodDescriptionOutput[number]>(
  food: T,
  grams: number
): T {
  const safeGrams = Number.isFinite(grams) ? Math.max(0, grams) : 0;

  return {
    ...food,
    estimatedGrams: safeGrams,
    totals: scaleMacros(food.per100g, safeGrams),
  };
}

export function sumEntryTotals(entries: FoodLogEntry[]): MacroNutrients {
  return sumMacros(entries.map((entry) => entry.totals));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isMacroRecord(value: unknown): value is MacroNutrients {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (
    isFiniteNumber((value as MacroNutrients).energyKcal) &&
    isFiniteNumber((value as MacroNutrients).proteinGrams) &&
    isFiniteNumber((value as MacroNutrients).carbohydrateGrams) &&
    isFiniteNumber((value as MacroNutrients).fatGrams)
  );
}

export function isFoodLogEntryArray(value: unknown): value is FoodLogEntry[] {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((entry) => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    const candidate = entry as FoodLogEntry;

    return (
      typeof candidate.id === 'string' &&
      typeof candidate.foodName === 'string' &&
      typeof candidate.quantityDescription === 'string' &&
      isFiniteNumber(candidate.estimatedGrams) &&
      isFiniteNumber(candidate.confidence) &&
      typeof candidate.sourceKind === 'string' &&
      typeof candidate.sourceLabel === 'string' &&
      isMacroRecord(candidate.per100g) &&
      isMacroRecord(candidate.totals) &&
      isFiniteNumber(candidate.timestamp)
    );
  });
}

export function isMacroGoals(value: unknown): value is MacroGoals {
  return isMacroRecord(value);
}
