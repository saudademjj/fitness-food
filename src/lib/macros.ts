export interface MacroNutrients {
  energyKcal: number;
  proteinGrams: number;
  carbohydrateGrams: number;
  fatGrams: number;
}

export const MACRO_KEYS = [
  'energyKcal',
  'proteinGrams',
  'carbohydrateGrams',
  'fatGrams',
] as const;

export type MacroKey = (typeof MACRO_KEYS)[number];

export const EMPTY_MACROS: MacroNutrients = {
  energyKcal: 0,
  proteinGrams: 0,
  carbohydrateGrams: 0,
  fatGrams: 0,
};

function roundToSingleDecimal(value: number): number {
  return Number(value.toFixed(1));
}

export function scaleMacros(
  per100g: MacroNutrients,
  grams: number,
  amountBasisG = 100
): MacroNutrients {
  const safeGrams = Number.isFinite(grams) ? Math.max(0, grams) : 0;
  const safeBasis = Number.isFinite(amountBasisG) && amountBasisG > 0 ? amountBasisG : 100;
  const ratio = safeGrams / safeBasis;

  return {
    energyKcal: roundToSingleDecimal(per100g.energyKcal * ratio),
    proteinGrams: roundToSingleDecimal(per100g.proteinGrams * ratio),
    carbohydrateGrams: roundToSingleDecimal(per100g.carbohydrateGrams * ratio),
    fatGrams: roundToSingleDecimal(per100g.fatGrams * ratio),
  };
}

export function sumMacros(items: MacroNutrients[]): MacroNutrients {
  return items.reduce<MacroNutrients>(
    (acc, item) => ({
      energyKcal: roundToSingleDecimal(acc.energyKcal + item.energyKcal),
      proteinGrams: roundToSingleDecimal(acc.proteinGrams + item.proteinGrams),
      carbohydrateGrams: roundToSingleDecimal(acc.carbohydrateGrams + item.carbohydrateGrams),
      fatGrams: roundToSingleDecimal(acc.fatGrams + item.fatGrams),
    }),
    {...EMPTY_MACROS}
  );
}
