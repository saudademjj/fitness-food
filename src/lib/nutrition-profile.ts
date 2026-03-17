export const CORE_MACRO_KEYS = [
  'energyKcal',
  'proteinGrams',
  'carbohydrateGrams',
  'fatGrams',
] as const;

export type MacroKey = (typeof CORE_MACRO_KEYS)[number];
export type NutrientGroupId = 'macros' | 'electrolytes' | 'minerals' | 'vitamins';
export type GoalDirection = 'target' | 'limit';

type NutrientFieldDefinition = {
  label: string;
  unit: string;
  group: NutrientGroupId;
  upperBound: number;
  defaultGoal: number;
  tone: string;
  goalDirection: GoalDirection;
};

const GROUP_LABELS: Record<NutrientGroupId, string> = {
  macros: '宏量营养',
  electrolytes: '电解质',
  minerals: '矿物质',
  vitamins: '维生素',
};

const GROUP_ORDER = ['macros', 'electrolytes', 'minerals', 'vitamins'] as const;

export const NUTRITION_FIELD_METADATA = {
  energyKcal: {
    label: '热量',
    unit: 'kcal',
    group: 'macros',
    upperBound: 900,
    defaultGoal: 2000,
    tone: 'bg-orange-500',
    goalDirection: 'target',
  },
  proteinGrams: {
    label: '蛋白质',
    unit: 'g',
    group: 'macros',
    upperBound: 100,
    defaultGoal: 120,
    tone: 'bg-primary',
    goalDirection: 'target',
  },
  carbohydrateGrams: {
    label: '碳水',
    unit: 'g',
    group: 'macros',
    upperBound: 100,
    defaultGoal: 225,
    tone: 'bg-accent',
    goalDirection: 'target',
  },
  fatGrams: {
    label: '脂肪',
    unit: 'g',
    group: 'macros',
    upperBound: 100,
    defaultGoal: 65,
    tone: 'bg-yellow-500',
    goalDirection: 'target',
  },
  fiberGrams: {
    label: '膳食纤维',
    unit: 'g',
    group: 'macros',
    upperBound: 60,
    defaultGoal: 30,
    tone: 'bg-emerald-500',
    goalDirection: 'target',
  },
  sugarsGrams: {
    label: '添加糖上限',
    unit: 'g',
    group: 'macros',
    upperBound: 100,
    defaultGoal: 50,
    tone: 'bg-pink-500',
    goalDirection: 'limit',
  },
  sodiumMg: {
    label: '钠上限',
    unit: 'mg',
    group: 'electrolytes',
    upperBound: 4000,
    defaultGoal: 2000,
    tone: 'bg-sky-500',
    goalDirection: 'limit',
  },
  potassiumMg: {
    label: '钾',
    unit: 'mg',
    group: 'electrolytes',
    upperBound: 5000,
    defaultGoal: 3500,
    tone: 'bg-cyan-500',
    goalDirection: 'target',
  },
  calciumMg: {
    label: '钙',
    unit: 'mg',
    group: 'minerals',
    upperBound: 2500,
    defaultGoal: 1000,
    tone: 'bg-indigo-500',
    goalDirection: 'target',
  },
  magnesiumMg: {
    label: '镁',
    unit: 'mg',
    group: 'minerals',
    upperBound: 700,
    defaultGoal: 400,
    tone: 'bg-violet-500',
    goalDirection: 'target',
  },
  ironMg: {
    label: '铁',
    unit: 'mg',
    group: 'minerals',
    upperBound: 45,
    defaultGoal: 18,
    tone: 'bg-rose-500',
    goalDirection: 'target',
  },
  zincMg: {
    label: '锌',
    unit: 'mg',
    group: 'minerals',
    upperBound: 40,
    defaultGoal: 11,
    tone: 'bg-amber-500',
    goalDirection: 'target',
  },
  vitaminAMcg: {
    label: '维生素A',
    unit: 'mcg',
    group: 'vitamins',
    upperBound: 3000,
    defaultGoal: 900,
    tone: 'bg-lime-500',
    goalDirection: 'target',
  },
  vitaminCMg: {
    label: '维生素C',
    unit: 'mg',
    group: 'vitamins',
    upperBound: 2000,
    defaultGoal: 100,
    tone: 'bg-green-500',
    goalDirection: 'target',
  },
  vitaminDMcg: {
    label: '维生素D',
    unit: 'mcg',
    group: 'vitamins',
    upperBound: 100,
    defaultGoal: 15,
    tone: 'bg-yellow-400',
    goalDirection: 'target',
  },
  vitaminEMg: {
    label: '维生素E',
    unit: 'mg',
    group: 'vitamins',
    upperBound: 150,
    defaultGoal: 15,
    tone: 'bg-amber-400',
    goalDirection: 'target',
  },
  vitaminKMcg: {
    label: '维生素K',
    unit: 'mcg',
    group: 'vitamins',
    upperBound: 1200,
    defaultGoal: 120,
    tone: 'bg-emerald-600',
    goalDirection: 'target',
  },
  thiaminMg: {
    label: '维生素B1',
    unit: 'mg',
    group: 'vitamins',
    upperBound: 50,
    defaultGoal: 1.2,
    tone: 'bg-blue-500',
    goalDirection: 'target',
  },
  riboflavinMg: {
    label: '维生素B2',
    unit: 'mg',
    group: 'vitamins',
    upperBound: 50,
    defaultGoal: 1.3,
    tone: 'bg-blue-600',
    goalDirection: 'target',
  },
  niacinMg: {
    label: '维生素B3',
    unit: 'mg',
    group: 'vitamins',
    upperBound: 100,
    defaultGoal: 16,
    tone: 'bg-fuchsia-500',
    goalDirection: 'target',
  },
  vitaminB6Mg: {
    label: '维生素B6',
    unit: 'mg',
    group: 'vitamins',
    upperBound: 50,
    defaultGoal: 1.7,
    tone: 'bg-purple-500',
    goalDirection: 'target',
  },
  vitaminB12Mcg: {
    label: '维生素B12',
    unit: 'mcg',
    group: 'vitamins',
    upperBound: 1000,
    defaultGoal: 2.4,
    tone: 'bg-purple-600',
    goalDirection: 'target',
  },
  folateMcg: {
    label: '叶酸',
    unit: 'mcg',
    group: 'vitamins',
    upperBound: 1000,
    defaultGoal: 400,
    tone: 'bg-teal-500',
    goalDirection: 'target',
  },
} as const satisfies Record<string, NutrientFieldDefinition>;

export type NutritionFieldKey = keyof typeof NUTRITION_FIELD_METADATA;
export type NutritionValue = number | null;
export type NutrientDataStatus = 'measured' | 'estimated' | 'partial' | 'missing';
export type NutrientDataSource = 'database' | 'ai' | 'database+ai' | 'mixed';

export const NUTRITION_PROFILE_KEYS = Object.keys(
  NUTRITION_FIELD_METADATA
) as NutritionFieldKey[];
export const NON_CORE_NUTRITION_KEYS = NUTRITION_PROFILE_KEYS.filter(
  (key) => !CORE_MACRO_KEYS.includes(key as MacroKey)
);

export interface NutritionProfile23 {
  energyKcal: NutritionValue;
  proteinGrams: NutritionValue;
  carbohydrateGrams: NutritionValue;
  fatGrams: NutritionValue;
  fiberGrams: NutritionValue;
  sugarsGrams: NutritionValue;
  sodiumMg: NutritionValue;
  potassiumMg: NutritionValue;
  calciumMg: NutritionValue;
  magnesiumMg: NutritionValue;
  ironMg: NutritionValue;
  zincMg: NutritionValue;
  vitaminAMcg: NutritionValue;
  vitaminCMg: NutritionValue;
  vitaminDMcg: NutritionValue;
  vitaminEMg: NutritionValue;
  vitaminKMcg: NutritionValue;
  thiaminMg: NutritionValue;
  riboflavinMg: NutritionValue;
  niacinMg: NutritionValue;
  vitaminB6Mg: NutritionValue;
  vitaminB12Mcg: NutritionValue;
  folateMcg: NutritionValue;
}

export interface NutrientDatumMeta {
  status: NutrientDataStatus;
  source: NutrientDataSource;
}

export type NutritionProfileMeta23 = Record<NutritionFieldKey, NutrientDatumMeta>;
export type MacroNutrients = Pick<NutritionProfile23, MacroKey>;

const DEFAULT_MISSING_NUTRIENT_META: NutrientDatumMeta = {
  status: 'missing',
  source: 'mixed',
};

export const GENERAL_UPPER_BOUNDS = NUTRITION_PROFILE_KEYS.reduce<
  Record<NutritionFieldKey, number>
>((acc, key) => {
  acc[key] = NUTRITION_FIELD_METADATA[key].upperBound;
  return acc;
}, {} as Record<NutritionFieldKey, number>);

export const EMPTY_NUTRITION_PROFILE: NutritionProfile23 = NUTRITION_PROFILE_KEYS.reduce(
  (acc, key) => {
    acc[key] = null;
    return acc;
  },
  {} as NutritionProfile23
);

export const ZERO_NUTRITION_PROFILE: NutritionProfile23 = NUTRITION_PROFILE_KEYS.reduce(
  (acc, key) => {
    acc[key] = 0;
    return acc;
  },
  {} as NutritionProfile23
);

export const EMPTY_NUTRITION_PROFILE_META: NutritionProfileMeta23 =
  NUTRITION_PROFILE_KEYS.reduce((acc, key) => {
    acc[key] = {...DEFAULT_MISSING_NUTRIENT_META};
    return acc;
  }, {} as NutritionProfileMeta23);

export const EMPTY_MACROS: MacroNutrients = {
  energyKcal: 0,
  proteinGrams: 0,
  carbohydrateGrams: 0,
  fatGrams: 0,
};

export const NUTRIENT_GROUPS: Array<{
  id: NutrientGroupId;
  label: string;
  fields: Array<{key: NutritionFieldKey; label: string; unit: string}>;
}> = GROUP_ORDER.map((groupId) => ({
  id: groupId,
  label: GROUP_LABELS[groupId],
  fields: NUTRITION_PROFILE_KEYS.filter(
    (key) => NUTRITION_FIELD_METADATA[key].group === groupId
  ).map((key) => ({
    key,
    label: NUTRITION_FIELD_METADATA[key].label,
    unit: NUTRITION_FIELD_METADATA[key].unit,
  })),
}));

function roundToSingleDecimal(value: number): number {
  return Number(value.toFixed(1));
}

function sanitizeNumber(
  value: number | null | undefined,
  missingValue: NutritionValue
): NutritionValue {
  return Number.isFinite(value) ? Number(value) : missingValue;
}

function summarizeSources(
  sources: NutrientDataSource[],
  fallback: NutrientDataSource
): NutrientDataSource {
  const uniqueSources = [...new Set(sources.filter(Boolean))];
  if (!uniqueSources.length) {
    return fallback;
  }

  return uniqueSources.length === 1 ? uniqueSources[0]! : 'mixed';
}

export function isKnownNutritionValue(value: NutritionValue | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function coalesceNutritionValue(
  value: NutritionValue | undefined,
  fallback = 0
): number {
  return isKnownNutritionValue(value) ? value : fallback;
}

export function getNutrientFieldMeta(key: NutritionFieldKey) {
  return NUTRITION_FIELD_METADATA[key];
}

export function createNutritionProfile(
  partial: Partial<NutritionProfile23> = {},
  missingValue: NutritionValue = null
): NutritionProfile23 {
  return NUTRITION_PROFILE_KEYS.reduce<NutritionProfile23>(
    (acc, key) => {
      acc[key] = sanitizeNumber(partial[key], missingValue);
      return acc;
    },
    {...(missingValue === null ? EMPTY_NUTRITION_PROFILE : ZERO_NUTRITION_PROFILE)}
  );
}

export function createNutritionProfileMeta(
  partial: Partial<NutritionProfileMeta23> = {},
  fill: NutrientDatumMeta = DEFAULT_MISSING_NUTRIENT_META
): NutritionProfileMeta23 {
  return NUTRITION_PROFILE_KEYS.reduce<NutritionProfileMeta23>(
    (acc, key) => {
      acc[key] = partial[key] ? {...partial[key]!} : {...fill};
      return acc;
    },
    {} as NutritionProfileMeta23
  );
}

export function cloneNutritionProfileMeta(meta: NutritionProfileMeta23): NutritionProfileMeta23 {
  return createNutritionProfileMeta(meta);
}

export function buildNutritionProfileMeta(
  profile: NutritionProfile23,
  options: {
    knownStatus?: Exclude<NutrientDataStatus, 'partial' | 'missing'>;
    knownSource?: NutrientDataSource;
    missingSource?: NutrientDataSource;
  } = {}
): NutritionProfileMeta23 {
  const knownStatus = options.knownStatus ?? 'measured';
  const knownSource = options.knownSource ?? 'database';
  const missingSource = options.missingSource ?? knownSource;

  return createNutritionProfileMeta(
    NUTRITION_PROFILE_KEYS.reduce<Partial<NutritionProfileMeta23>>((acc, key) => {
      acc[key] = isKnownNutritionValue(profile[key])
        ? {
            status: knownStatus,
            source: knownSource,
          }
        : {
            status: 'missing',
            source: missingSource,
          };
      return acc;
    }, {})
  );
}

export function normalizeNutritionValue(
  value: number | null | undefined,
  amountBasisG: number
): NutritionValue {
  if (!Number.isFinite(value)) {
    return null;
  }

  const safeBasis = Number.isFinite(amountBasisG) && amountBasisG > 0 ? amountBasisG : 100;
  return Number((((value as number) * 100) / safeBasis).toFixed(4));
}

export function scaleNutritionProfile(
  per100g: NutritionProfile23,
  grams: number,
  amountBasisG = 100
): NutritionProfile23 {
  const safeGrams = Number.isFinite(grams) ? Math.max(0, grams) : 0;
  const safeBasis = Number.isFinite(amountBasisG) && amountBasisG > 0 ? amountBasisG : 100;
  const ratio = safeGrams / safeBasis;

  return NUTRITION_PROFILE_KEYS.reduce<NutritionProfile23>(
    (acc, key) => {
      acc[key] = isKnownNutritionValue(per100g[key])
        ? roundToSingleDecimal(per100g[key]! * ratio)
        : null;
      return acc;
    },
    {...EMPTY_NUTRITION_PROFILE}
  );
}

export function convertTotalsToPer100g(
  totals: NutritionProfile23,
  grams: number,
  amountBasisG = 100
): NutritionProfile23 {
  const safeGrams = Number.isFinite(grams) && grams > 0 ? grams : amountBasisG;
  const ratio = amountBasisG / safeGrams;

  return NUTRITION_PROFILE_KEYS.reduce<NutritionProfile23>(
    (acc, key) => {
      acc[key] = isKnownNutritionValue(totals[key])
        ? roundToSingleDecimal(totals[key]! * ratio)
        : null;
      return acc;
    },
    {...EMPTY_NUTRITION_PROFILE}
  );
}

export function sumNutritionProfiles(items: NutritionProfile23[]): NutritionProfile23 {
  return NUTRITION_PROFILE_KEYS.reduce<NutritionProfile23>(
    (acc, key) => {
      const knownValues = items
        .map((item) => item[key])
        .filter((value): value is number => isKnownNutritionValue(value));
      acc[key] = knownValues.length
        ? roundToSingleDecimal(knownValues.reduce((sum, value) => sum + value, 0))
        : null;
      return acc;
    },
    {...EMPTY_NUTRITION_PROFILE}
  );
}

export function aggregateNutritionProfiles(
  items: Array<{profile: NutritionProfile23; meta: NutritionProfileMeta23}>
): {profile: NutritionProfile23; meta: NutritionProfileMeta23} {
  const profile = createNutritionProfile();
  const meta = createNutritionProfileMeta();

  for (const key of NUTRITION_PROFILE_KEYS) {
    const knownItems = items.filter((item) => isKnownNutritionValue(item.profile[key]));
    const missingItems = items.filter((item) => item.meta[key].status === 'missing');

    profile[key] = knownItems.length
      ? roundToSingleDecimal(
          knownItems.reduce((sum, item) => sum + coalesceNutritionValue(item.profile[key]), 0)
        )
      : null;

    if (!knownItems.length) {
      meta[key] = {
        status: 'missing',
        source: summarizeSources(
          items.map((item) => item.meta[key].source),
          DEFAULT_MISSING_NUTRIENT_META.source
        ),
      };
      continue;
    }

    if (missingItems.length) {
      meta[key] = {
        status: 'partial',
        source: summarizeSources(
          items
            .filter((item) => item.meta[key].status !== 'missing')
            .map((item) => item.meta[key].source),
          'mixed'
        ),
      };
      continue;
    }

    const derivedStatus = knownItems.some((item) => item.meta[key].status !== 'measured')
      ? 'estimated'
      : 'measured';
    meta[key] = {
      status: derivedStatus,
      source: summarizeSources(
        knownItems.map((item) => item.meta[key].source),
        'mixed'
      ),
    };
  }

  return {profile, meta};
}

export function mergeNutritionProfiles(
  primary: NutritionProfile23,
  primaryMeta: NutritionProfileMeta23,
  fallback: NutritionProfile23,
  fallbackMeta: NutritionProfileMeta23,
  fillKeys: NutritionFieldKey[] = NUTRITION_PROFILE_KEYS
): {
  profile: NutritionProfile23;
  meta: NutritionProfileMeta23;
  filledKeys: NutritionFieldKey[];
} {
  const fillKeySet = new Set(fillKeys);
  const profile = createNutritionProfile(primary);
  const meta = createNutritionProfileMeta(primaryMeta);
  const filledKeys: NutritionFieldKey[] = [];

  for (const key of NUTRITION_PROFILE_KEYS) {
    if (isKnownNutritionValue(primary[key]) || !fillKeySet.has(key)) {
      continue;
    }

    if (!isKnownNutritionValue(fallback[key])) {
      continue;
    }

    profile[key] = fallback[key];
    meta[key] = {
      status: fallbackMeta[key].status === 'missing' ? 'estimated' : fallbackMeta[key].status,
      source:
        primaryMeta[key].source === 'database' || primaryMeta[key].source === 'database+ai'
          ? 'database+ai'
          : fallbackMeta[key].source,
    };
    filledKeys.push(key);
  }

  return {profile, meta, filledKeys};
}

export function pickMacroNutrients(profile: NutritionProfile23): MacroNutrients {
  return CORE_MACRO_KEYS.reduce<MacroNutrients>(
    (acc, key) => {
      acc[key] = profile[key];
      return acc;
    },
    {...EMPTY_MACROS}
  );
}

export function hasAnyNutritionValue(profile: NutritionProfile23): boolean {
  return NUTRITION_PROFILE_KEYS.some((key) => coalesceNutritionValue(profile[key]) > 0);
}
