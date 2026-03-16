export const CORE_MACRO_KEYS = [
  'energyKcal',
  'proteinGrams',
  'carbohydrateGrams',
  'fatGrams',
] as const;

export const NUTRITION_PROFILE_KEYS = [
  ...CORE_MACRO_KEYS,
  'fiberGrams',
  'sugarsGrams',
  'sodiumMg',
  'potassiumMg',
  'calciumMg',
  'magnesiumMg',
  'ironMg',
  'zincMg',
  'vitaminAMcg',
  'vitaminCMg',
  'vitaminDMcg',
  'vitaminEMg',
  'vitaminKMcg',
  'thiaminMg',
  'riboflavinMg',
  'niacinMg',
  'vitaminB6Mg',
  'vitaminB12Mcg',
  'folateMcg',
] as const;

export type MacroKey = (typeof CORE_MACRO_KEYS)[number];
export type NutritionFieldKey = (typeof NUTRITION_PROFILE_KEYS)[number];

export interface NutritionProfile23 {
  energyKcal: number;
  proteinGrams: number;
  carbohydrateGrams: number;
  fatGrams: number;
  fiberGrams: number;
  sugarsGrams: number;
  sodiumMg: number;
  potassiumMg: number;
  calciumMg: number;
  magnesiumMg: number;
  ironMg: number;
  zincMg: number;
  vitaminAMcg: number;
  vitaminCMg: number;
  vitaminDMcg: number;
  vitaminEMg: number;
  vitaminKMcg: number;
  thiaminMg: number;
  riboflavinMg: number;
  niacinMg: number;
  vitaminB6Mg: number;
  vitaminB12Mcg: number;
  folateMcg: number;
}

export type MacroNutrients = Pick<NutritionProfile23, MacroKey>;

export const EMPTY_NUTRITION_PROFILE: NutritionProfile23 = {
  energyKcal: 0,
  proteinGrams: 0,
  carbohydrateGrams: 0,
  fatGrams: 0,
  fiberGrams: 0,
  sugarsGrams: 0,
  sodiumMg: 0,
  potassiumMg: 0,
  calciumMg: 0,
  magnesiumMg: 0,
  ironMg: 0,
  zincMg: 0,
  vitaminAMcg: 0,
  vitaminCMg: 0,
  vitaminDMcg: 0,
  vitaminEMg: 0,
  vitaminKMcg: 0,
  thiaminMg: 0,
  riboflavinMg: 0,
  niacinMg: 0,
  vitaminB6Mg: 0,
  vitaminB12Mcg: 0,
  folateMcg: 0,
};

export const EMPTY_MACROS: MacroNutrients = {
  energyKcal: 0,
  proteinGrams: 0,
  carbohydrateGrams: 0,
  fatGrams: 0,
};

export const NUTRIENT_GROUPS = [
  {
    id: 'macros',
    label: '宏量营养',
    fields: [
      {key: 'energyKcal', label: '热量', unit: 'kcal'},
      {key: 'proteinGrams', label: '蛋白质', unit: 'g'},
      {key: 'carbohydrateGrams', label: '碳水', unit: 'g'},
      {key: 'fatGrams', label: '脂肪', unit: 'g'},
      {key: 'fiberGrams', label: '膳食纤维', unit: 'g'},
      {key: 'sugarsGrams', label: '糖', unit: 'g'},
    ],
  },
  {
    id: 'electrolytes',
    label: '电解质',
    fields: [
      {key: 'sodiumMg', label: '钠', unit: 'mg'},
      {key: 'potassiumMg', label: '钾', unit: 'mg'},
    ],
  },
  {
    id: 'minerals',
    label: '矿物质',
    fields: [
      {key: 'calciumMg', label: '钙', unit: 'mg'},
      {key: 'magnesiumMg', label: '镁', unit: 'mg'},
      {key: 'ironMg', label: '铁', unit: 'mg'},
      {key: 'zincMg', label: '锌', unit: 'mg'},
    ],
  },
  {
    id: 'vitamins',
    label: '维生素',
    fields: [
      {key: 'vitaminAMcg', label: '维生素A', unit: 'mcg'},
      {key: 'vitaminCMg', label: '维生素C', unit: 'mg'},
      {key: 'vitaminDMcg', label: '维生素D', unit: 'mcg'},
      {key: 'vitaminEMg', label: '维生素E', unit: 'mg'},
      {key: 'vitaminKMcg', label: '维生素K', unit: 'mcg'},
      {key: 'thiaminMg', label: '维生素B1', unit: 'mg'},
      {key: 'riboflavinMg', label: '维生素B2', unit: 'mg'},
      {key: 'niacinMg', label: '维生素B3', unit: 'mg'},
      {key: 'vitaminB6Mg', label: '维生素B6', unit: 'mg'},
      {key: 'vitaminB12Mcg', label: '维生素B12', unit: 'mcg'},
      {key: 'folateMcg', label: '叶酸', unit: 'mcg'},
    ],
  },
] as const satisfies Array<{
  id: string;
  label: string;
  fields: Array<{key: NutritionFieldKey; label: string; unit: string}>;
}>;

function roundToSingleDecimal(value: number): number {
  return Number(value.toFixed(1));
}

function sanitizeNumber(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

export function createNutritionProfile(
  partial: Partial<NutritionProfile23> = {}
): NutritionProfile23 {
  return NUTRITION_PROFILE_KEYS.reduce<NutritionProfile23>(
    (acc, key) => {
      acc[key] = sanitizeNumber(partial[key]);
      return acc;
    },
    {...EMPTY_NUTRITION_PROFILE}
  );
}

export function normalizeNutritionValue(
  value: number | null | undefined,
  amountBasisG: number
): number {
  const safeBasis = Number.isFinite(amountBasisG) && amountBasisG > 0 ? amountBasisG : 100;
  return Number(((sanitizeNumber(value) * 100) / safeBasis).toFixed(4));
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
      acc[key] = roundToSingleDecimal(per100g[key] * ratio);
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
      acc[key] = roundToSingleDecimal(totals[key] * ratio);
      return acc;
    },
    {...EMPTY_NUTRITION_PROFILE}
  );
}

export function sumNutritionProfiles(items: NutritionProfile23[]): NutritionProfile23 {
  return items.reduce<NutritionProfile23>(
    (acc, item) =>
      NUTRITION_PROFILE_KEYS.reduce<NutritionProfile23>((nextAcc, key) => {
        nextAcc[key] = roundToSingleDecimal(acc[key] + item[key]);
        return nextAcc;
      }, {...acc}),
    {...EMPTY_NUTRITION_PROFILE}
  );
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
  return NUTRITION_PROFILE_KEYS.some((key) => profile[key] > 0);
}
