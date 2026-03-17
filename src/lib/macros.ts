import {
  CORE_MACRO_KEYS,
  EMPTY_MACROS,
  ZERO_NUTRITION_PROFILE,
  pickMacroNutrients,
  scaleNutritionProfile,
  sumNutritionProfiles,
  type MacroKey,
  type MacroNutrients,
} from '@/lib/nutrition-profile';

export {
  CORE_MACRO_KEYS as MACRO_KEYS,
  EMPTY_MACROS,
  ZERO_NUTRITION_PROFILE as EMPTY_NUTRITION_PROFILE,
  pickMacroNutrients,
};

export type {MacroKey, MacroNutrients};

export function scaleMacros(
  per100g: MacroNutrients,
  grams: number,
  amountBasisG = 100
): MacroNutrients {
  return pickMacroNutrients(
    scaleNutritionProfile(
      {
        ...ZERO_NUTRITION_PROFILE,
        ...per100g,
      },
      grams,
      amountBasisG
    )
  );
}

export function sumMacros(items: MacroNutrients[]): MacroNutrients {
  return pickMacroNutrients(
    sumNutritionProfiles(
      items.map((item) => ({
        ...ZERO_NUTRITION_PROFILE,
        ...item,
      }))
    )
  );
}
