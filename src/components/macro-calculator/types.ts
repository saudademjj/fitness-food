
export interface FoodLogEntry {
  id: string;
  foodName: string;
  quantityDescription: string;
  estimatedGrams: number;
  timestamp: number;
  
  // Macros
  energyKcal: number;
  proteinGrams: number;
  fatGrams: number;
  carbohydrateGrams: number;
  fiberGrams: number;
  sugarsGrams: number;
  
  // Minerals
  sodiumMg: number;
  potassiumMg: number;
  calciumMg: number;
  magnesiumMg: number;
  ironMg: number;
  zincMg: number;
  
  // Vitamins
  vitaminAMcg: number;
  vitaminCMg: number;
  vitaminDMcg: number;
  vitaminEMg: number;
  vitaminKMcg: number;
  thiaminMg: number; // B1
  riboflavinMg: number; // B2
  niacinMg: number; // B3
  vitaminB6Mg: number;
  vitaminB12Mcg: number;
  folateMcg: number;
}

export interface MacroGoals {
  energyKcal: number;
  proteinGrams: number;
  fatGrams: number;
  carbohydrateGrams: number;
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
