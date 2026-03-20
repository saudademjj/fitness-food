import {COMPOSITE_FOOD_PATTERN} from '@/lib/food-text';
import {
  GENERAL_UPPER_BOUNDS,
  NUTRITION_PROFILE_KEYS,
  coalesceNutritionValue,
  createNutritionProfile,
  type NutritionFieldKey,
  type NutritionProfile23,
} from '@/lib/nutrition-profile';

export type ValidationFlag =
  | 'ai_macro_estimate'
  | 'ai_macro_clamped'
  | 'ai_secondary_reviewed'
  | 'ai_secondary_adjusted'
  | 'ai_secondary_review_failed'
  | 'db_lookup_miss'
  | 'db_candidate_rejected'
  | 'db_candidate_thermodynamic_mismatch'
  | 'brand_curated_override'
  | 'portion_reference_applied'
  | 'portion_keyword_applied'
  | 'portion_fallback_applied'
  | 'portion_size_adjusted'
  | 'portion_preparation_adjusted'
  | 'composite_total_rebalanced'
  | 'whole_dish_db_override'
  | 'whole_dish_component_aligned'
  | 'runtime_recipe_ingredients'
  | 'runtime_ai_ingredients'
  | 'ingredient_ai_macro_estimate'
  | 'ingredient_reference_micros_merged'
  | 'low_confidence'
  | 'ai_macro_unverified'
  | 'db_micronutrient_gap'
  | 'db_micronutrient_ai_merged'
  | 'nutrition_partial'
  | 'nutrition_unknown';

export type NutritionCategory =
  | 'beverage'
  | 'fruit_veg'
  | 'staple'
  | 'protein_food'
  | 'mixed_dish'
  | 'dessert_snack'
  | 'unknown';

export type MacroValidationIssue =
  | 'energy_out_of_range'
  | 'energy_too_low'
  | 'protein_out_of_range'
  | 'carbohydrate_out_of_range'
  | 'fat_out_of_range'
  | 'fiber_out_of_range'
  | 'sugars_out_of_range'
  | 'sodium_out_of_range'
  | 'potassium_out_of_range'
  | 'calcium_out_of_range'
  | 'magnesium_out_of_range'
  | 'iron_out_of_range'
  | 'zinc_out_of_range'
  | 'vitamin_a_out_of_range'
  | 'vitamin_c_out_of_range'
  | 'vitamin_d_out_of_range'
  | 'vitamin_e_out_of_range'
  | 'vitamin_k_out_of_range'
  | 'thiamin_out_of_range'
  | 'riboflavin_out_of_range'
  | 'niacin_out_of_range'
  | 'vitamin_b6_out_of_range'
  | 'vitamin_b12_out_of_range'
  | 'folate_out_of_range'
  | 'sugars_exceed_carbohydrate'
  | 'fiber_exceed_carbohydrate'
  | 'thermodynamic_mismatch'
  | 'category_mismatch';

type CategoryConstraint = {
  minEnergy: number;
  maxEnergy: number;
  minProtein: number;
  maxProtein: number;
  minCarbohydrate: number;
  maxCarbohydrate: number;
  minFat: number;
  maxFat: number;
  energyBias: 'carbohydrate' | 'protein' | 'fat';
  fieldRanges?: Partial<Record<NutritionFieldKey, {min: number; max: number}>>;
};

type CategorySignal = {
  category: Exclude<NutritionCategory, 'unknown'>;
  pattern: RegExp;
  weight: number;
};

const CATEGORY_CONSTRAINTS: Record<Exclude<NutritionCategory, 'unknown'>, CategoryConstraint> = {
  beverage: {
    minEnergy: 5,
    maxEnergy: 180,
    minProtein: 0,
    maxProtein: 15,
    minCarbohydrate: 0,
    maxCarbohydrate: 25,
    minFat: 0,
    maxFat: 12,
    energyBias: 'carbohydrate',
    fieldRanges: {
      fiberGrams: {min: 0, max: 2},
      sodiumMg: {min: 0, max: 220},
      potassiumMg: {min: 0, max: 650},
      calciumMg: {min: 0, max: 260},
      magnesiumMg: {min: 0, max: 80},
      ironMg: {min: 0, max: 1.2},
      zincMg: {min: 0, max: 1.5},
      vitaminAMcg: {min: 0, max: 220},
      vitaminCMg: {min: 0, max: 120},
      vitaminDMcg: {min: 0, max: 3},
      vitaminEMg: {min: 0, max: 2.5},
      vitaminKMcg: {min: 0, max: 25},
      thiaminMg: {min: 0, max: 0.3},
      riboflavinMg: {min: 0, max: 0.6},
      niacinMg: {min: 0, max: 3},
      vitaminB6Mg: {min: 0, max: 0.4},
      vitaminB12Mcg: {min: 0, max: 2},
      folateMcg: {min: 0, max: 90},
    },
  },
  fruit_veg: {
    minEnergy: 8,
    maxEnergy: 180,
    minProtein: 0,
    maxProtein: 12,
    minCarbohydrate: 0,
    maxCarbohydrate: 35,
    minFat: 0,
    maxFat: 10,
    energyBias: 'carbohydrate',
    fieldRanges: {
      fiberGrams: {min: 0.8, max: 10},
      sodiumMg: {min: 0, max: 260},
      potassiumMg: {min: 80, max: 1200},
      calciumMg: {min: 5, max: 220},
      magnesiumMg: {min: 8, max: 140},
      ironMg: {min: 0.2, max: 6},
      zincMg: {min: 0, max: 1.5},
      vitaminAMcg: {min: 0, max: 1400},
      vitaminCMg: {min: 2, max: 220},
      vitaminDMcg: {min: 0, max: 0.2},
      vitaminEMg: {min: 0, max: 6},
      vitaminKMcg: {min: 0, max: 650},
      thiaminMg: {min: 0, max: 0.3},
      riboflavinMg: {min: 0, max: 0.35},
      niacinMg: {min: 0, max: 3.5},
      vitaminB6Mg: {min: 0.03, max: 0.8},
      vitaminB12Mcg: {min: 0, max: 0.1},
      folateMcg: {min: 8, max: 240},
    },
  },
  staple: {
    minEnergy: 40,
    maxEnergy: 450,
    minProtein: 0,
    maxProtein: 20,
    minCarbohydrate: 6,
    maxCarbohydrate: 90,
    minFat: 0,
    maxFat: 35,
    energyBias: 'carbohydrate',
    fieldRanges: {
      fiberGrams: {min: 0.3, max: 15},
      sodiumMg: {min: 0, max: 650},
      potassiumMg: {min: 10, max: 550},
      calciumMg: {min: 0, max: 220},
      magnesiumMg: {min: 3, max: 160},
      ironMg: {min: 0.2, max: 8},
      zincMg: {min: 0.1, max: 3},
      vitaminAMcg: {min: 0, max: 900},
      vitaminCMg: {min: 0, max: 60},
      vitaminDMcg: {min: 0, max: 0.2},
      vitaminEMg: {min: 0, max: 3},
      vitaminKMcg: {min: 0, max: 45},
      thiaminMg: {min: 0.02, max: 0.9},
      riboflavinMg: {min: 0, max: 0.4},
      niacinMg: {min: 0.1, max: 9},
      vitaminB6Mg: {min: 0.02, max: 0.55},
      vitaminB12Mcg: {min: 0, max: 0.2},
      folateMcg: {min: 5, max: 200},
    },
  },
  protein_food: {
    minEnergy: 45,
    maxEnergy: 450,
    minProtein: 6,
    maxProtein: 45,
    minCarbohydrate: 0,
    maxCarbohydrate: 25,
    minFat: 0,
    maxFat: 35,
    energyBias: 'protein',
    fieldRanges: {
      fiberGrams: {min: 0, max: 5},
      sodiumMg: {min: 20, max: 1400},
      potassiumMg: {min: 100, max: 950},
      calciumMg: {min: 0, max: 320},
      magnesiumMg: {min: 10, max: 160},
      ironMg: {min: 0.3, max: 10},
      zincMg: {min: 0.3, max: 9},
      vitaminAMcg: {min: 0, max: 1200},
      vitaminCMg: {min: 0, max: 20},
      vitaminDMcg: {min: 0, max: 25},
      vitaminEMg: {min: 0, max: 5},
      vitaminKMcg: {min: 0, max: 140},
      thiaminMg: {min: 0.02, max: 1.4},
      riboflavinMg: {min: 0.02, max: 1.4},
      niacinMg: {min: 0.4, max: 20},
      vitaminB6Mg: {min: 0.04, max: 1.8},
      vitaminB12Mcg: {min: 0, max: 30},
      folateMcg: {min: 2, max: 200},
    },
  },
  mixed_dish: {
    minEnergy: 60,
    maxEnergy: 450,
    minProtein: 2,
    maxProtein: 30,
    minCarbohydrate: 4,
    maxCarbohydrate: 65,
    minFat: 1,
    maxFat: 30,
    energyBias: 'carbohydrate',
    fieldRanges: {
      fiberGrams: {min: 0.5, max: 12},
      sodiumMg: {min: 80, max: 1800},
      potassiumMg: {min: 0, max: 900},
      calciumMg: {min: 5, max: 360},
      magnesiumMg: {min: 0, max: 130},
      ironMg: {min: 0.3, max: 8},
      zincMg: {min: 0, max: 5},
      vitaminAMcg: {min: 0, max: 1200},
      vitaminCMg: {min: 0, max: 120},
      vitaminDMcg: {min: 0, max: 12},
      vitaminEMg: {min: 0, max: 5},
      vitaminKMcg: {min: 0, max: 260},
      thiaminMg: {min: 0, max: 0.9},
      riboflavinMg: {min: 0, max: 0.7},
      niacinMg: {min: 0, max: 12},
      vitaminB6Mg: {min: 0, max: 0.9},
      vitaminB12Mcg: {min: 0, max: 14},
      folateMcg: {min: 0, max: 220},
    },
  },
  dessert_snack: {
    minEnergy: 35,
    maxEnergy: 650,
    minProtein: 0,
    maxProtein: 18,
    minCarbohydrate: 6,
    maxCarbohydrate: 90,
    minFat: 0,
    maxFat: 50,
    energyBias: 'carbohydrate',
    fieldRanges: {
      fiberGrams: {min: 0, max: 8},
      sodiumMg: {min: 0, max: 900},
      potassiumMg: {min: 0, max: 450},
      calciumMg: {min: 0, max: 260},
      magnesiumMg: {min: 0, max: 90},
      ironMg: {min: 0, max: 6},
      zincMg: {min: 0, max: 2.5},
      vitaminAMcg: {min: 0, max: 600},
      vitaminCMg: {min: 0, max: 90},
      vitaminDMcg: {min: 0, max: 6},
      vitaminEMg: {min: 0, max: 4},
      vitaminKMcg: {min: 0, max: 60},
      thiaminMg: {min: 0, max: 0.45},
      riboflavinMg: {min: 0, max: 0.55},
      niacinMg: {min: 0, max: 4.5},
      vitaminB6Mg: {min: 0, max: 0.35},
      vitaminB12Mcg: {min: 0, max: 2.5},
      folateMcg: {min: 0, max: 120},
    },
  },
};

const CATEGORY_SIGNALS: CategorySignal[] = [
  {category: 'mixed_dish', pattern: COMPOSITE_FOOD_PATTERN, weight: 5},
  {
    category: 'beverage',
    pattern:
      /(牛奶|豆浆|酸奶|奶茶|咖啡|果汁|可乐|雪碧|芬达|饮料|啤酒|茶|柠檬水|苏打|气泡水|奶昔|拿铁|美式|乌龙|豆乳)/i,
    weight: 4,
  },
  {
    category: 'mixed_dish',
    pattern:
      /(炒饭|蛋炒饭|盖饭|拌饭|焖饭|烩饭|便当|套餐|炒面|拌面|汤面|拉面|米线|河粉|炒粉|意面|三明治|汉堡|披萨|卷饼|沙拉|火锅|麻辣烫|冒菜|砂锅|小炒|炒菜|鸡丁|肉末|汤|煲|锅|咖喱|饭团|寿司|拼盘|盖浇)/i,
    weight: 4,
  },
  {
    category: 'dessert_snack',
    pattern:
      /(蛋糕|饼干|布丁|甜筒|冰淇淋|雪糕|糖|巧克力|薯片|果冻|麻花|泡芙|月饼|甜品|糕点|奥利奥|辣条|爆米花|蛋挞)/i,
    weight: 4,
  },
  {
    category: 'protein_food',
    pattern:
      /(鸡胸|鸡腿|鸡翅|鸡肉|牛肉|羊肉|猪肉|鱼肉|虾|蟹|排骨|牛排|鱼排|鸡蛋|鸭蛋|鹅蛋|豆腐|里脊|鸡心|鸡胗|火腿|香肠)/i,
    weight: 3,
  },
  {
    category: 'staple',
    pattern:
      /(米饭|白饭|面条|面包|馒头|包子|饺子|汤圆|粽子|年糕|手抓饼|煎饼果子|油条|玉米|红薯|土豆|粥|面|粉|饭|饼)/i,
    weight: 3,
  },
  {
    category: 'fruit_veg',
    pattern:
      /(苹果|香蕉|橙子|梨|桃|芒果|葡萄|西瓜|猕猴桃|草莓|柚子|番茄|黄瓜|茄子|豆角|洋葱|胡萝卜|西兰花|蘑菇|木耳|海带|紫菜|莲藕|山药|芋头|蔬菜|水果|沙拉菜)/i,
    weight: 3,
  },
];

const FIELD_ISSUE_MAP: Partial<Record<NutritionFieldKey, MacroValidationIssue>> = {
  energyKcal: 'energy_out_of_range',
  proteinGrams: 'protein_out_of_range',
  carbohydrateGrams: 'carbohydrate_out_of_range',
  fatGrams: 'fat_out_of_range',
  fiberGrams: 'fiber_out_of_range',
  sugarsGrams: 'sugars_out_of_range',
  sodiumMg: 'sodium_out_of_range',
  potassiumMg: 'potassium_out_of_range',
  calciumMg: 'calcium_out_of_range',
  magnesiumMg: 'magnesium_out_of_range',
  ironMg: 'iron_out_of_range',
  zincMg: 'zinc_out_of_range',
  vitaminAMcg: 'vitamin_a_out_of_range',
  vitaminCMg: 'vitamin_c_out_of_range',
  vitaminDMcg: 'vitamin_d_out_of_range',
  vitaminEMg: 'vitamin_e_out_of_range',
  vitaminKMcg: 'vitamin_k_out_of_range',
  thiaminMg: 'thiamin_out_of_range',
  riboflavinMg: 'riboflavin_out_of_range',
  niacinMg: 'niacin_out_of_range',
  vitaminB6Mg: 'vitamin_b6_out_of_range',
  vitaminB12Mcg: 'vitamin_b12_out_of_range',
  folateMcg: 'folate_out_of_range',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number): number {
  return Number(value.toFixed(1));
}

function roundIfKnown(value: number | null): number | null {
  return value === null ? null : round(value);
}

function expectedEnergy(profile: NutritionProfile23): number {
  return round(
    coalesceNutritionValue(profile.proteinGrams) * 4 +
      coalesceNutritionValue(profile.carbohydrateGrams) * 4 +
      coalesceNutritionValue(profile.fatGrams) * 9
  );
}

function getCategoryConstraint(category: NutritionCategory): CategoryConstraint | null {
  if (category === 'unknown') {
    return null;
  }
  return CATEGORY_CONSTRAINTS[category];
}

function getCategoryScores(foodName: string): Record<Exclude<NutritionCategory, 'unknown'>, number> {
  const normalized = foodName.trim();
  const scores: Record<Exclude<NutritionCategory, 'unknown'>, number> = {
    beverage: 0,
    fruit_veg: 0,
    staple: 0,
    protein_food: 0,
    mixed_dish: 0,
    dessert_snack: 0,
  };

  if (!normalized) {
    return scores;
  }

  for (const signal of CATEGORY_SIGNALS) {
    if (signal.pattern.test(normalized)) {
      scores[signal.category] += signal.weight;
    }
  }

  if (/(炒|煮|蒸|炸|烤|炖|焖|拌|汤|煲|锅)/.test(normalized)) {
    scores.mixed_dish += 2;
  }

  if (/(和|配|拼|双拼|套餐)/.test(normalized)) {
    scores.mixed_dish += 1;
  }

  if (scores.beverage > 0 && /(饭|面|汉堡|披萨|包子|饼|肉|蛋)/.test(normalized)) {
    scores.beverage = Math.max(0, scores.beverage - 2);
  }

  return scores;
}

function raiseEnergyFloor(
  profile: NutritionProfile23,
  constraint: CategoryConstraint
): NutritionProfile23 {
  const nextProfile = createNutritionProfile(profile);
  const currentEnergy = expectedEnergy(nextProfile);
  if (currentEnergy >= constraint.minEnergy) {
    nextProfile.energyKcal = currentEnergy;
    return nextProfile;
  }

  const deficit = constraint.minEnergy - currentEnergy;
  if (constraint.energyBias === 'protein') {
    nextProfile.proteinGrams = round(
      clamp(
        coalesceNutritionValue(nextProfile.proteinGrams, constraint.minProtein) + deficit / 4,
        constraint.minProtein,
        constraint.maxProtein
      )
    );
  } else if (constraint.energyBias === 'fat') {
    nextProfile.fatGrams = round(
      clamp(
        coalesceNutritionValue(nextProfile.fatGrams, constraint.minFat) + deficit / 9,
        constraint.minFat,
        constraint.maxFat
      )
    );
  } else {
    nextProfile.carbohydrateGrams = round(
      clamp(
        coalesceNutritionValue(nextProfile.carbohydrateGrams, constraint.minCarbohydrate) +
          deficit / 4,
        constraint.minCarbohydrate,
        constraint.maxCarbohydrate
      )
    );
  }

  nextProfile.energyKcal = expectedEnergy(nextProfile);
  return nextProfile;
}

function enforceCategoryRanges(
  profile: NutritionProfile23,
  category: NutritionCategory
): NutritionProfile23 {
  const constraint = getCategoryConstraint(category);
  if (!constraint) {
    return createNutritionProfile({
      ...profile,
      energyKcal: profile.energyKcal === null ? null : expectedEnergy(profile),
    });
  }

  const nextProfile = createNutritionProfile(profile);
  nextProfile.proteinGrams =
    nextProfile.proteinGrams === null
      ? null
      : round(clamp(nextProfile.proteinGrams, constraint.minProtein, constraint.maxProtein));
  nextProfile.carbohydrateGrams =
    nextProfile.carbohydrateGrams === null
      ? null
      : round(
          clamp(
            nextProfile.carbohydrateGrams,
            constraint.minCarbohydrate,
            constraint.maxCarbohydrate
          )
        );
  nextProfile.fatGrams =
    nextProfile.fatGrams === null
      ? null
      : round(clamp(nextProfile.fatGrams, constraint.minFat, constraint.maxFat));
  for (const [key, range] of Object.entries(constraint.fieldRanges ?? {}) as Array<
    [NutritionFieldKey, {min: number; max: number}]
  >) {
    if (nextProfile[key] === null) {
      continue;
    }

    nextProfile[key] = round(clamp(nextProfile[key]!, range.min, range.max));
  }
  nextProfile.energyKcal = nextProfile.energyKcal === null ? null : expectedEnergy(nextProfile);

  const withEnergyFloor = raiseEnergyFloor(nextProfile, constraint);
  withEnergyFloor.energyKcal =
    withEnergyFloor.energyKcal === null
      ? null
      : round(clamp(withEnergyFloor.energyKcal, constraint.minEnergy, constraint.maxEnergy));
  return withEnergyFloor;
}

function clampMicronutrients(profile: NutritionProfile23): NutritionProfile23 {
  const nextProfile = createNutritionProfile(profile);
  for (const key of NUTRITION_PROFILE_KEYS) {
    nextProfile[key] =
      nextProfile[key] === null
        ? null
        : round(clamp(nextProfile[key]!, 0, GENERAL_UPPER_BOUNDS[key]));
  }

  if (nextProfile.fiberGrams !== null && nextProfile.carbohydrateGrams !== null) {
    nextProfile.fiberGrams = round(
      Math.min(nextProfile.fiberGrams, nextProfile.carbohydrateGrams)
    );
  }

  if (nextProfile.sugarsGrams !== null && nextProfile.carbohydrateGrams !== null) {
    nextProfile.sugarsGrams = round(
      Math.min(nextProfile.sugarsGrams, nextProfile.carbohydrateGrams)
    );
  }

  return nextProfile;
}

function buildValidationIssues(
  value: NutritionProfile23,
  category: NutritionCategory,
  tolerance: number
): MacroValidationIssue[] {
  const issues: MacroValidationIssue[] = [];
  const constraint = getCategoryConstraint(category);

  for (const key of NUTRITION_PROFILE_KEYS) {
    if (value[key] !== null && value[key]! > GENERAL_UPPER_BOUNDS[key]) {
      const issue = FIELD_ISSUE_MAP[key];
      if (issue) {
        issues.push(issue);
      }
    }
  }

  if (value.energyKcal !== null && value.energyKcal < (constraint?.minEnergy ?? 5)) {
    issues.push('energy_too_low');
  }

  if (
    value.sugarsGrams !== null &&
    value.carbohydrateGrams !== null &&
    value.sugarsGrams > value.carbohydrateGrams
  ) {
    issues.push('sugars_exceed_carbohydrate');
  }

  if (
    value.fiberGrams !== null &&
    value.carbohydrateGrams !== null &&
    value.fiberGrams > value.carbohydrateGrams
  ) {
    issues.push('fiber_exceed_carbohydrate');
  }

  if (constraint) {
    const isOutsideCategoryRange =
      (value.energyKcal !== null &&
        (value.energyKcal < constraint.minEnergy || value.energyKcal > constraint.maxEnergy)) ||
      (value.proteinGrams !== null &&
        (value.proteinGrams < constraint.minProtein || value.proteinGrams > constraint.maxProtein)) ||
      (value.carbohydrateGrams !== null &&
        (value.carbohydrateGrams < constraint.minCarbohydrate ||
          value.carbohydrateGrams > constraint.maxCarbohydrate)) ||
      (value.fatGrams !== null &&
        (value.fatGrams < constraint.minFat || value.fatGrams > constraint.maxFat));

    const isOutsideMicronutrientRange = Object.entries(constraint.fieldRanges ?? {}).some(
      ([key, range]) => {
        const typedKey = key as NutritionFieldKey;
        return (
          value[typedKey] !== null &&
          (value[typedKey]! > range.max ||
            (range.min > 0 && value[typedKey]! > 0 && value[typedKey]! < range.min))
        );
      }
    );

    if (isOutsideCategoryRange || isOutsideMicronutrientRange) {
      issues.push('category_mismatch');
    }
  }

  if (value.energyKcal !== null) {
    const calculatedEnergy = expectedEnergy(value);
    const denominator = Math.max(value.energyKcal, calculatedEnergy, 1);
    if (Math.abs(value.energyKcal - calculatedEnergy) / denominator > tolerance) {
      issues.push('thermodynamic_mismatch');
    }
  }

  return [...new Set(issues)];
}

export function getNutritionCategory(foodName: string): NutritionCategory {
  const normalized = foodName.trim();
  if (!normalized) {
    return 'unknown';
  }

  const scores = getCategoryScores(normalized);
  const ranked = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([category, score]) => ({
      category: category as Exclude<NutritionCategory, 'unknown'>,
      score,
    }));
  const top = ranked[0];
  if (!top || top.score <= 0) {
    return 'unknown';
  }

  const activeCategories = ranked
    .filter((item) => item.score > 0 && item.score >= Math.max(2, top.score - 1))
    .map((item) => item.category);

  if (activeCategories.includes('mixed_dish')) {
    return 'mixed_dish';
  }

  if (activeCategories.includes('protein_food') && activeCategories.includes('staple')) {
    return 'mixed_dish';
  }

  if (activeCategories.includes('protein_food') && activeCategories.includes('fruit_veg')) {
    return 'mixed_dish';
  }

  return top.category;
}

export function validateMacroNutrients(
  value: NutritionProfile23,
  tolerance = 0.12,
  foodName = ''
): MacroValidationIssue[] {
  const category = getNutritionCategory(foodName);
  return buildValidationIssues(createNutritionProfile(value), category, tolerance);
}

export function sanitizeFallbackNutritionProfile(
  foodName: string,
  value: NutritionProfile23
): {
  profile: NutritionProfile23;
  issues: MacroValidationIssue[];
  remainingIssues: MacroValidationIssue[];
  category: NutritionCategory;
  adjusted: boolean;
} {
  const category = getNutritionCategory(foodName);
  const originalProfile = createNutritionProfile(value);
  const issues = validateMacroNutrients(originalProfile, 0.12, foodName);
  const clampedProfile = clampMicronutrients(enforceCategoryRanges(originalProfile, category));
  const finalProfile = createNutritionProfile({
    ...clampedProfile,
    energyKcal:
      clampedProfile.energyKcal === null ? null : roundIfKnown(expectedEnergy(clampedProfile)),
  });
  const remainingIssues = validateMacroNutrients(finalProfile, 0.12, foodName);

  return {
    profile: finalProfile,
    issues,
    remainingIssues,
    category,
    adjusted:
      issues.length > 0 &&
      JSON.stringify(originalProfile) !== JSON.stringify(finalProfile),
  };
}

export function dedupeValidationFlags(flags: ValidationFlag[]): ValidationFlag[] {
  return [...new Set(flags)];
}
