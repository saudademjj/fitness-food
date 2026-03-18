import type {ResolvedFoodItem, ResolvedFoodItems} from '@/lib/food-contract';
import {
  CORE_MACRO_KEYS,
  NUTRITION_PROFILE_KEYS,
  aggregateNutritionProfiles,
  buildNutritionProfileMeta,
  cloneNutritionProfileMeta,
  createNutritionProfile,
  getNutrientFieldMeta,
  NUTRIENT_GROUPS,
  scaleNutritionProfile,
  type NutritionFieldKey,
  type NutritionProfile23,
  type NutritionProfileMeta23,
} from '@/lib/nutrition-profile';
import {getDateKeyFromTimestamp, isDateKey} from '@/lib/log-date';

export type FoodLogEntry = ResolvedFoodItem & {
  id: string;
  timestamp: number;
  loggedOn?: string;
  foodLogId?: string;
  draftBatchId?: string;
};

export type NutritionAggregate = {
  profile: NutritionProfile23;
  meta: NutritionProfileMeta23;
};

export const GOAL_FIELD_KEYS = [...NUTRITION_PROFILE_KEYS] as NutritionFieldKey[];

export type GoalFieldKey = NutritionFieldKey;
export type MacroGoals = Record<GoalFieldKey, number>;

export const GOAL_FIELDS: Array<{
  key: GoalFieldKey;
  label: string;
  unit: string;
  tone: string;
  goalDirection: ReturnType<typeof getNutrientFieldMeta>['goalDirection'];
}> = GOAL_FIELD_KEYS.map((key) => {
  const meta = getNutrientFieldMeta(key);
  return {
    key,
    label: meta.label,
    unit: meta.unit,
    tone: meta.tone,
    goalDirection: meta.goalDirection,
  };
});

export const GOAL_FIELD_GROUPS = NUTRIENT_GROUPS.map((group) => ({
  ...group,
  fields: group.fields.map((field) =>
    GOAL_FIELDS.find((goalField) => goalField.key === field.key)!
  ),
}));

export const DEFAULT_GOALS: MacroGoals = GOAL_FIELD_KEYS.reduce<MacroGoals>((acc, key) => {
  acc[key] = getNutrientFieldMeta(key).defaultGoal;
  return acc;
}, {} as MacroGoals);

export const ENTRY_STORAGE_KEY = 'macro_helper_entries_v3';
export const GOAL_STORAGE_KEY = 'macro_helper_goals_v3';
export const MIGRATION_STORAGE_KEY = 'macro_helper_entries_migrated_v1';

export function createEntryId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `entry_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function updateFoodWeight<T extends ResolvedFoodItem>(
  food: T,
  grams: number
): T {
  const safeGrams = Number.isFinite(grams) ? Math.max(0, grams) : 0;

  return {
    ...food,
    estimatedGrams: safeGrams,
    totals: scaleNutritionProfile(food.per100g, safeGrams),
    totalsMeta: cloneNutritionProfileMeta(food.per100gMeta),
  };
}

export function sumEntryTotals(entries: FoodLogEntry[]): NutritionAggregate {
  return aggregateNutritionProfiles(
    entries.map((entry) => ({
      profile: entry.totals,
      meta: entry.totalsMeta,
    }))
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableNutritionNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
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
    isNullableNutritionNumber((value as Record<string, number | null>)[key])
  );
}

function isNutritionProfileMeta(value: unknown): value is NutritionProfileMeta23 {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return NUTRITION_PROFILE_KEYS.every((key) => {
    const field = (value as Record<string, {status?: string; source?: string}>)[key];
    return (
      field &&
      typeof field.status === 'string' &&
      typeof field.source === 'string'
    );
  });
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
    return createNutritionProfile(value);
  }

  if (isLegacyMacroShape(value)) {
    return createNutritionProfile(value);
  }

  return null;
}

function buildLegacyNutritionMeta(
  profile: NutritionProfile23,
  sourceKind: FoodLogEntry['sourceKind']
): NutritionProfileMeta23 {
  const knownSource = sourceKind === 'ai_fallback' ? 'ai' : 'database';
  const knownStatus = sourceKind === 'ai_fallback' ? 'estimated' : 'measured';

  return buildNutritionProfileMeta(
    createNutritionProfile(
      NUTRITION_PROFILE_KEYS.reduce<Partial<NutritionProfile23>>((acc, key) => {
        const value = profile[key];
        if (CORE_MACRO_KEYS.includes(key as (typeof CORE_MACRO_KEYS)[number])) {
          acc[key] = value;
          return acc;
        }

        acc[key] =
          sourceKind === 'ai_fallback' || (value !== null && value > 0) ? value : null;
        return acc;
      }, {})
    ),
    {
      knownStatus,
      knownSource,
      missingSource: knownSource,
    }
  );
}

function coerceNutritionProfileMeta(
  value: unknown,
  profile: NutritionProfile23,
  sourceKind: FoodLogEntry['sourceKind']
): NutritionProfileMeta23 {
  if (isNutritionProfileMeta(value)) {
    return value;
  }

  return buildLegacyNutritionMeta(profile, sourceKind);
}

export function isFoodLogEntryArray(value: unknown): value is FoodLogEntry[] {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((entry) => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    const candidate = entry as FoodLogEntry & {
      per100gMeta?: NutritionProfileMeta23;
      totalsMeta?: NutritionProfileMeta23;
    };

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
      (candidate.loggedOn === undefined ||
        (typeof candidate.loggedOn === 'string' && isDateKey(candidate.loggedOn))) &&
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

  return value.map((entry) => {
    const per100g = coerceNutritionProfile(entry.per100g)!;
    const totals = coerceNutritionProfile(entry.totals)!;

    return {
      ...entry,
      loggedOn:
        typeof entry.loggedOn === 'string' && isDateKey(entry.loggedOn)
          ? entry.loggedOn
          : getDateKeyFromTimestamp(entry.timestamp),
      per100g,
      totals,
      per100gMeta: coerceNutritionProfileMeta(
        (entry as FoodLogEntry & {per100gMeta?: NutritionProfileMeta23}).per100gMeta,
        per100g,
        entry.sourceKind
      ),
      totalsMeta: coerceNutritionProfileMeta(
        (entry as FoodLogEntry & {totalsMeta?: NutritionProfileMeta23}).totalsMeta,
        totals,
        entry.sourceKind
      ),
    };
  });
}

export function coerceMacroGoals(value: unknown): MacroGoals | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const hasAnyGoalValue =
    GOAL_FIELD_KEYS.some((key) => isFiniteNumber(candidate[key])) || isLegacyMacroShape(value);
  if (!hasAnyGoalValue) {
    return null;
  }

  return GOAL_FIELD_KEYS.reduce<MacroGoals>(
    (acc, key) => {
      acc[key] = isFiniteNumber(candidate[key])
        ? (candidate[key] as number)
        : DEFAULT_GOALS[key];
      return acc;
    },
    {...DEFAULT_GOALS}
  );
}

export function isMacroGoals(value: unknown): value is MacroGoals {
  return isGoalRecord(value);
}
