
import type {ParseFoodDescriptionOutput} from '@/lib/food-contract';
import {
  NUTRITION_PROFILE_KEYS,
  createNutritionProfile,
  scaleNutritionProfile,
  sumNutritionProfiles,
  type NutritionProfile23,
} from '@/lib/nutrition-profile';

export type FoodLogEntry = ParseFoodDescriptionOutput[number] & {
  id: string;
  timestamp: number;
  foodLogId?: string;
  draftBatchId?: string;
};

export const GOAL_FIELD_KEYS = [
  'energyKcal',
  'proteinGrams',
  'carbohydrateGrams',
  'fatGrams',
  'fiberGrams',
  'sodiumMg',
  'calciumMg',
  'ironMg',
] as const;

export type GoalFieldKey = (typeof GOAL_FIELD_KEYS)[number];

export interface MacroGoals extends Pick<NutritionProfile23, GoalFieldKey> {}

export const GOAL_FIELDS: Array<{
  key: GoalFieldKey;
  label: string;
  unit: string;
  tone: string;
}> = [
  {key: 'energyKcal', label: '热量', unit: 'kcal', tone: 'bg-orange-500'},
  {key: 'proteinGrams', label: '蛋白质', unit: 'g', tone: 'bg-primary'},
  {key: 'carbohydrateGrams', label: '碳水', unit: 'g', tone: 'bg-accent'},
  {key: 'fatGrams', label: '脂肪', unit: 'g', tone: 'bg-yellow-500'},
  {key: 'fiberGrams', label: '膳食纤维', unit: 'g', tone: 'bg-emerald-500'},
  {key: 'sodiumMg', label: '钠上限', unit: 'mg', tone: 'bg-sky-500'},
  {key: 'calciumMg', label: '钙', unit: 'mg', tone: 'bg-indigo-500'},
  {key: 'ironMg', label: '铁', unit: 'mg', tone: 'bg-rose-500'},
];

export const DEFAULT_GOALS: MacroGoals = {
  energyKcal: 2000,
  proteinGrams: 120,
  fatGrams: 65,
  carbohydrateGrams: 225,
  fiberGrams: 30,
  sodiumMg: 2000,
  calciumMg: 1000,
  ironMg: 18,
};

export const ENTRY_STORAGE_KEY = 'macro_helper_entries_v3';
export const GOAL_STORAGE_KEY = 'macro_helper_goals_v3';
export const MIGRATION_STORAGE_KEY = 'macro_helper_entries_migrated_v1';

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
    totals: scaleNutritionProfile(food.per100g, safeGrams),
  };
}

export function sumEntryTotals(entries: FoodLogEntry[]): NutritionProfile23 {
  return sumNutritionProfiles(entries.map((entry) => entry.totals));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isGoalRecord(value: unknown): value is MacroGoals {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return GOAL_FIELD_KEYS.every((key) =>
    isFiniteNumber((value as Record<string, number>)[key])
  );
}

function isNutritionProfile(value: unknown): value is NutritionProfile23 {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return NUTRITION_PROFILE_KEYS.every((key) =>
    isFiniteNumber((value as Record<string, number>)[key])
  );
}

function isLegacyMacroShape(
  value: unknown
): value is Pick<MacroGoals, 'energyKcal' | 'proteinGrams' | 'carbohydrateGrams' | 'fatGrams'> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return ['energyKcal', 'proteinGrams', 'carbohydrateGrams', 'fatGrams'].every((key) =>
    isFiniteNumber((value as Record<string, number>)[key])
  );
}

function coerceNutritionProfile(value: unknown): NutritionProfile23 | null {
  if (isNutritionProfile(value)) {
    return value;
  }

  if (isLegacyMacroShape(value)) {
    return createNutritionProfile(value);
  }

  return null;
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
      typeof candidate.matchMode === 'string' &&
      typeof candidate.sourceStatus === 'string' &&
      isFiniteNumber(candidate.amountBasisG) &&
      Array.isArray(candidate.validationFlags) &&
      Boolean(coerceNutritionProfile(candidate.per100g)) &&
      Boolean(coerceNutritionProfile(candidate.totals)) &&
      isFiniteNumber(candidate.timestamp)
    );
  });
}

export function coerceFoodLogEntryArray(value: unknown): FoodLogEntry[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  if (!isFoodLogEntryArray(value)) {
    return null;
  }

  return value.map((entry) => ({
    ...entry,
    per100g: coerceNutritionProfile(entry.per100g)!,
    totals: coerceNutritionProfile(entry.totals)!,
  }));
}

export function coerceMacroGoals(value: unknown): MacroGoals | null {
  if (isGoalRecord(value)) {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  if (!isLegacyMacroShape(value)) {
    return null;
  }

  return GOAL_FIELD_KEYS.reduce<MacroGoals>(
    (acc, key) => {
      acc[key] = isFiniteNumber((value as Record<string, number>)[key])
        ? (value as Record<string, number>)[key]
        : DEFAULT_GOALS[key];
      return acc;
    },
    {...DEFAULT_GOALS}
  );
}

export function isMacroGoals(value: unknown): value is MacroGoals {
  return isGoalRecord(value);
}
