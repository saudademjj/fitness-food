import {getDbPool} from '@/lib/db';
import {normalizeLookupText, parseQuantity} from '@/lib/food-text';
import {
  buildNutritionProfileMeta,
  cloneNutritionProfileMeta,
  createNutritionProfileMeta,
  createNutritionProfile,
  isKnownNutritionValue,
  type NutritionFieldKey,
  type NutritionProfile23,
  type NutritionProfileMeta23,
} from '@/lib/nutrition-profile';
import {getRuntimeLookupVersion} from '@/lib/runtime-cache-version';
import {recordRuntimeError} from '@/lib/runtime-observability';
import type {ValidationFlag} from '@/lib/validation';
import {getNutritionCategory, type NutritionCategory} from '@/lib/validation';

type PortionReferenceRow = {
  food_name_zh: string;
  normalized_name_zh: string;
  default_grams: number;
  unit_grams: Record<string, number> | null;
  size_multipliers: Record<string, number> | null;
  preparation_multipliers: Record<string, number> | null;
  density_g_per_ml: number | null;
  confidence_score: number | null;
  reference_source: string;
  notes: string | null;
  priority: number;
};
type PortionKeywordRow = PortionReferenceRow & {
  matched_keyword: string;
};

type PortionModifiers = {
  baseName: string;
  sizeKey: string | null;
  preparationKey: string | null;
};

type PreparationNutritionRule = {
  additives?: Partial<Record<NutritionFieldKey, number>>;
  multipliers?: Partial<Record<NutritionFieldKey, number>>;
};

type FallbackPortionHeuristic = {
  defaultGrams: number;
  confidenceScore: number;
  units?: Partial<Record<string, number>>;
  densityGPerMl?: number;
  sizeMultipliers?: Partial<Record<string, number>>;
  preparationMultipliers?: Partial<Record<string, number>>;
  notes: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __fitnessFoodPortionLookupCache:
    | Map<string, {expiresAt: number; value: Promise<PortionLookupResult | null>}>
    | undefined;
}

export type PortionLookupResult = {
  matchedName: string;
  defaultGrams: number;
  unitGrams: Record<string, number>;
  sizeMultipliers: Record<string, number>;
  preparationMultipliers: Record<string, number>;
  densityGPerMl: number | null;
  confidenceScore: number;
  sourceLabel: string;
  notes: string | null;
  matchStrategy: 'exact' | 'keyword' | 'fallback';
};

const PORTION_LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;
const PORTION_LOOKUP_CACHE_MAX_SIZE = 512;
const EXACT_MATCH_ONLY_KEYWORDS = new Set(['粉', '面', '饭', '饼', '汤', '羹', '粥']);

const DEFAULT_SIZE_MULTIPLIERS: Record<string, number> = {
  小: 0.75,
  中: 1,
  大: 1.35,
  超大: 1.6,
};

const DEFAULT_PREPARATION_MULTIPLIERS: Record<string, number> = {
  生: 1,
  熟: 0.92,
  煮: 1,
  蒸: 0.95,
  炒: 1.08,
  炸: 0.9,
  烤: 0.88,
  炖: 1.1,
  汤: 1.2,
};

const PREPARATION_NUTRITION_RULES: Record<
  string,
  {default?: PreparationNutritionRule} & Partial<
    Record<Exclude<NutritionCategory, 'unknown'>, PreparationNutritionRule>
  >
> = {
  生: {},
  熟: {
    default: {
      multipliers: {
        proteinGrams: 0.99,
        fatGrams: 0.98,
        vitaminCMg: 0.94,
        folateMcg: 0.95,
      },
    },
  },
  煮: {
    default: {
      multipliers: {
        proteinGrams: 0.97,
        fatGrams: 0.96,
        potassiumMg: 0.92,
        sodiumMg: 1.03,
        thiaminMg: 0.82,
        riboflavinMg: 0.88,
        niacinMg: 0.92,
        vitaminB6Mg: 0.8,
        vitaminCMg: 0.68,
        folateMcg: 0.72,
      },
    },
    fruit_veg: {
      multipliers: {
        potassiumMg: 0.88,
        vitaminCMg: 0.62,
        folateMcg: 0.68,
      },
    },
    protein_food: {
      multipliers: {
        thiaminMg: 0.78,
        niacinMg: 0.9,
        vitaminB6Mg: 0.84,
        vitaminB12Mcg: 0.92,
      },
    },
    staple: {
      multipliers: {
        thiaminMg: 0.8,
        folateMcg: 0.78,
      },
    },
  },
  蒸: {
    default: {
      multipliers: {
        proteinGrams: 0.99,
        fatGrams: 0.97,
        vitaminCMg: 0.88,
        folateMcg: 0.9,
      },
    },
    fruit_veg: {
      multipliers: {
        vitaminCMg: 0.8,
        folateMcg: 0.84,
      },
    },
  },
  炒: {
    default: {
      additives: {
        fatGrams: 4,
      },
      multipliers: {
        sodiumMg: 1.08,
      },
    },
    fruit_veg: {
      additives: {
        fatGrams: 5.5,
      },
      multipliers: {
        vitaminCMg: 0.72,
        folateMcg: 0.78,
        thiaminMg: 0.85,
        riboflavinMg: 0.9,
      },
    },
    protein_food: {
      additives: {
        fatGrams: 4.5,
      },
      multipliers: {
        thiaminMg: 0.9,
        niacinMg: 0.95,
        vitaminB6Mg: 0.9,
      },
    },
    staple: {
      additives: {
        fatGrams: 3.2,
      },
      multipliers: {
        thiaminMg: 0.9,
        riboflavinMg: 0.94,
      },
    },
    mixed_dish: {
      additives: {
        fatGrams: 3.8,
      },
      multipliers: {
        vitaminCMg: 0.82,
        folateMcg: 0.85,
      },
    },
  },
  炸: {
    default: {
      additives: {
        fatGrams: 12,
      },
      multipliers: {
        carbohydrateGrams: 1.03,
        sodiumMg: 1.12,
        vitaminCMg: 0.55,
        folateMcg: 0.6,
        thiaminMg: 0.72,
        riboflavinMg: 0.82,
      },
    },
    protein_food: {
      additives: {
        fatGrams: 14,
      },
      multipliers: {
        niacinMg: 0.9,
        vitaminB6Mg: 0.78,
        vitaminB12Mcg: 0.9,
      },
    },
    staple: {
      additives: {
        fatGrams: 10,
      },
      multipliers: {
        thiaminMg: 0.78,
      },
    },
    mixed_dish: {
      additives: {
        fatGrams: 11,
      },
    },
  },
  烤: {
    default: {
      additives: {
        fatGrams: 2.5,
      },
      multipliers: {
        sodiumMg: 1.05,
        vitaminCMg: 0.76,
        thiaminMg: 0.88,
        vitaminB6Mg: 0.9,
      },
    },
  },
  炖: {
    default: {
      multipliers: {
        sodiumMg: 1.06,
        potassiumMg: 0.9,
        vitaminCMg: 0.78,
        folateMcg: 0.84,
        thiaminMg: 0.86,
      },
    },
    protein_food: {
      multipliers: {
        fatGrams: 0.98,
        vitaminB12Mcg: 0.94,
      },
    },
  },
  汤: {
    default: {
      multipliers: {
        proteinGrams: 0.74,
        carbohydrateGrams: 0.9,
        fatGrams: 0.7,
        sodiumMg: 1.12,
        potassiumMg: 0.82,
        calciumMg: 0.92,
        ironMg: 0.84,
        vitaminCMg: 0.62,
        thiaminMg: 0.72,
        riboflavinMg: 0.8,
        folateMcg: 0.68,
      },
    },
    fruit_veg: {
      multipliers: {
        vitaminCMg: 0.55,
      },
    },
    protein_food: {
      multipliers: {
        vitaminB12Mcg: 0.9,
      },
    },
  },
};

const GENERIC_UNIT_GRAMS: Record<string, number> = {
  个: 100,
  只: 90,
  颗: 15,
  块: 60,
  片: 25,
  杯: 250,
  碗: 220,
  份: 180,
  盘: 240,
  盒: 250,
  瓶: 300,
  袋: 100,
  包: 100,
  串: 80,
  根: 50,
  条: 100,
  勺: 15,
  罐: 330,
  ml: 1,
  毫升: 1,
  g: 1,
  克: 1,
};

const CATEGORY_FALLBACK_HEURISTICS: Record<
  Exclude<NutritionCategory, 'unknown'>,
  FallbackPortionHeuristic
> = {
  beverage: {
    defaultGrams: 330,
    confidenceScore: 0.62,
    units: {杯: 330, 碗: 300, 瓶: 500, 罐: 330, ml: 1, 毫升: 1},
    densityGPerMl: 1,
    notes: '按饮品类别的通用杯量估重。',
  },
  fruit_veg: {
    defaultGrams: 180,
    confidenceScore: 0.58,
    units: {个: 180, 只: 180, 块: 90, 片: 90, 根: 120, 颗: 15, 份: 180},
    notes: '按蔬果类别的常见可食部估重。',
  },
  protein_food: {
    defaultGrams: 150,
    confidenceScore: 0.6,
    units: {份: 150, 块: 150, 片: 100, 个: 85, 只: 85, 串: 35},
    preparationMultipliers: {炸: 0.92, 烤: 0.9, 炖: 1.08},
    notes: '按蛋白类成品单份的通用熟重估重。',
  },
  staple: {
    defaultGrams: 180,
    confidenceScore: 0.58,
    units: {碗: 180, 份: 180, 个: 100, 只: 100, 片: 30, 根: 80},
    notes: '按主食类别的常见份量估重。',
  },
  mixed_dish: {
    defaultGrams: 260,
    confidenceScore: 0.55,
    units: {份: 260, 盘: 260, 碗: 300, 盒: 320},
    preparationMultipliers: {炒: 1.08, 汤: 1.18, 炖: 1.1},
    notes: '按成品菜/复合餐的一般出品重量估重。',
  },
  dessert_snack: {
    defaultGrams: 90,
    confidenceScore: 0.56,
    units: {块: 90, 片: 90, 个: 60, 只: 60, 份: 100},
    notes: '按零食甜点的常见单份估重。',
  },
};

const FORM_FACTOR_FALLBACK_RULES: Array<{
  pattern: RegExp;
  heuristic: FallbackPortionHeuristic;
}> = [
  {
    pattern: /(豆浆|豆乳)/i,
    heuristic: {
      defaultGrams: 300,
      confidenceScore: 0.72,
      units: {杯: 300, 碗: 300, 盒: 250, 瓶: 300, ml: 1.02, 毫升: 1.02},
      densityGPerMl: 1.02,
      notes: '按豆制饮品的常见杯量估重。',
    },
  },
  {
    pattern: /(牛奶|酸奶|奶昔)/i,
    heuristic: {
      defaultGrams: 250,
      confidenceScore: 0.7,
      units: {杯: 250, 盒: 250, 瓶: 250, ml: 1.03, 毫升: 1.03},
      densityGPerMl: 1.03,
      notes: '按乳制饮品的常见包装规格估重。',
    },
  },
  {
    pattern: /(可乐|雪碧|芬达|汽水|苏打|气泡水|饮料)/i,
    heuristic: {
      defaultGrams: 330,
      confidenceScore: 0.68,
      units: {罐: 330, 瓶: 500, 杯: 330, ml: 1, 毫升: 1},
      densityGPerMl: 1,
      notes: '按常见包装饮料规格估重。',
    },
  },
  {
    pattern: /(奶茶|果汁|咖啡|拿铁|美式|乌龙|红茶|绿茶|柠檬水)/i,
    heuristic: {
      defaultGrams: 450,
      confidenceScore: 0.64,
      units: {杯: 450, 瓶: 500, ml: 1.01, 毫升: 1.01},
      densityGPerMl: 1.01,
      notes: '按现制饮品常见大杯规格估重。',
    },
  },
  {
    pattern: /(粥)/i,
    heuristic: {
      defaultGrams: 300,
      confidenceScore: 0.68,
      units: {碗: 300, 杯: 300, 份: 300},
      notes: '按粥品单碗成品估重。',
    },
  },
  {
    pattern: /(汤|羹|煲)/i,
    heuristic: {
      defaultGrams: 380,
      confidenceScore: 0.62,
      units: {碗: 380, 份: 380, 盒: 450},
      preparationMultipliers: {汤: 1.18},
      notes: '按含汤成品的常见单碗重量估重。',
    },
  },
  {
    pattern: /(米饭|白饭|炒饭|盖饭|焖饭|烩饭|便当|套餐|饭团)/i,
    heuristic: {
      defaultGrams: 260,
      confidenceScore: 0.65,
      units: {碗: 180, 份: 260, 盘: 320, 盒: 320, 个: 110},
      preparationMultipliers: {炒: 1.08},
      notes: '按饭类主食或盒饭的通用成品份量估重。',
    },
  },
  {
    pattern: /(拉面|汤面|炒面|拌面|面条|米线|河粉|粉丝|粉条|意面|肠粉)/i,
    heuristic: {
      defaultGrams: 340,
      confidenceScore: 0.64,
      units: {碗: 340, 份: 340, 盘: 320},
      notes: '按面/粉类主食的通用成品份量估重。',
    },
  },
  {
    pattern: /(包子|馒头|花卷|烧卖|小笼|煎饼|饼)/i,
    heuristic: {
      defaultGrams: 100,
      confidenceScore: 0.63,
      units: {个: 100, 只: 100, 份: 120, 片: 60},
      notes: '按面点类单份成品估重。',
    },
  },
  {
    pattern: /(汉堡|三明治|卷饼|披萨)/i,
    heuristic: {
      defaultGrams: 220,
      confidenceScore: 0.64,
      units: {个: 220, 只: 220, 份: 220, 片: 120, 块: 120},
      notes: '按西式快餐/烘焙主食的常见单份估重。',
    },
  },
  {
    pattern: /(鸡蛋|鸭蛋|鹌鹑蛋|茶叶蛋|卤蛋|煮蛋|蒸蛋|炒蛋)/i,
    heuristic: {
      defaultGrams: 50,
      confidenceScore: 0.7,
      units: {个: 50, 只: 50, 颗: 50},
      notes: '按蛋类单枚可食部估重。',
    },
  },
  {
    pattern: /(饺子|锅贴|馄饨|汤圆|粽子)/i,
    heuristic: {
      defaultGrams: 28,
      confidenceScore: 0.62,
      units: {个: 28, 只: 28, 颗: 28, 碗: 240},
      notes: '按点心类单枚或单碗份量估重。',
    },
  },
  {
    pattern: /(肉串|烤串|串烧|串)/i,
    heuristic: {
      defaultGrams: 35,
      confidenceScore: 0.66,
      units: {串: 35, 根: 35},
      preparationMultipliers: {烤: 0.9},
      notes: '按串烧类单串熟重估重。',
    },
  },
  {
    pattern: /(麦乐鸡|mcnugget)/i,
    heuristic: {
      defaultGrams: 80,
      confidenceScore: 0.82,
      units: {份: 80, 块: 16, 个: 16},
      notes: '按麦当劳中国 5 块麦乐鸡默认规格估重。',
    },
  },
  {
    pattern: /(鸡块|nugget)/i,
    heuristic: {
      defaultGrams: 120,
      confidenceScore: 0.68,
      units: {份: 120, 块: 30, 个: 30},
      preparationMultipliers: {炸: 0.9},
      notes: '按常见无骨鸡块/鸡米花的较保守单块份量估重。',
    },
  },
  {
    pattern: /(薯条|鸡块|炸鸡|炸物)/i,
    heuristic: {
      defaultGrams: 110,
      confidenceScore: 0.62,
      units: {份: 110, 包: 110, 块: 45, 个: 45},
      preparationMultipliers: {炸: 0.9},
      notes: '按常见油炸快餐单份估重。',
    },
  },
  {
    pattern: /(蛋糕|蛋挞|面包|吐司|法棍|甜点|饼干)/i,
    heuristic: {
      defaultGrams: 90,
      confidenceScore: 0.6,
      units: {块: 90, 片: 90, 个: 80, 只: 80, 份: 100},
      notes: '按烘焙甜点的常见切块/单份估重。',
    },
  },
];

function sanitizeNumberRecord(value: Record<string, number | undefined> | null | undefined): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter((entry): entry is [string, number] =>
      Number.isFinite(entry[1])
    )
  );
}

function parseRow(row: PortionReferenceRow, matchStrategy: 'exact' | 'keyword'): PortionLookupResult {
  return {
    matchedName: row.food_name_zh,
    defaultGrams: row.default_grams,
    unitGrams: row.unit_grams ?? {},
    sizeMultipliers: row.size_multipliers ?? {},
    preparationMultipliers: row.preparation_multipliers ?? {},
    densityGPerMl: row.density_g_per_ml,
    confidenceScore: Number(row.confidence_score ?? (matchStrategy === 'exact' ? 0.95 : 0.8)),
    sourceLabel: row.reference_source,
    notes: row.notes,
    matchStrategy,
  };
}

function buildFallbackPortionResult(
  foodName: string,
  heuristic: FallbackPortionHeuristic
): PortionLookupResult {
  return {
    matchedName: foodName,
    defaultGrams: heuristic.defaultGrams,
    unitGrams: sanitizeNumberRecord(heuristic.units ?? {}),
    sizeMultipliers: sanitizeNumberRecord({
      ...DEFAULT_SIZE_MULTIPLIERS,
      ...(heuristic.sizeMultipliers ?? {}),
    }),
    preparationMultipliers: sanitizeNumberRecord({
      ...DEFAULT_PREPARATION_MULTIPLIERS,
      ...(heuristic.preparationMultipliers ?? {}),
    }),
    densityGPerMl: heuristic.densityGPerMl ?? null,
    confidenceScore: heuristic.confidenceScore,
    sourceLabel: '应用内通用回退估算',
    notes: heuristic.notes,
    matchStrategy: 'fallback',
  };
}

function extractPortionModifiers(value: string): PortionModifiers {
  const trimmed = value.trim();
  let baseName = trimmed;
  let sizeKey: string | null = null;
  let preparationKey: string | null = null;

  if (/^超大/.test(baseName)) {
    sizeKey = '超大';
    baseName = baseName.replace(/^超大/, '');
  } else if (/^大/.test(baseName)) {
    sizeKey = '大';
    baseName = baseName.replace(/^大/, '');
  } else if (/^中/.test(baseName)) {
    sizeKey = '中';
    baseName = baseName.replace(/^中/, '');
  } else if (/^小/.test(baseName)) {
    sizeKey = '小';
    baseName = baseName.replace(/^小/, '');
  }

  const prepMatch = baseName.match(/^(生|熟|煮|蒸|炒|炸|烤|炖|汤)(.+)$/);
  if (prepMatch) {
    preparationKey = prepMatch[1] ?? null;
    baseName = prepMatch[2] ?? baseName;
  }

  return {
    baseName: baseName.trim(),
    sizeKey,
    preparationKey,
  };
}

function mergeModifierSources(values: string[]): PortionModifiers {
  return values.reduce<PortionModifiers>(
    (acc, value) => {
      const next = extractPortionModifiers(value);
      return {
        baseName: acc.baseName || next.baseName,
        sizeKey: acc.sizeKey ?? next.sizeKey,
        preparationKey: acc.preparationKey ?? next.preparationKey,
      };
    },
    {baseName: '', sizeKey: null, preparationKey: null}
  );
}

function derivePreparationKey(
  foodName: string,
  matchedName?: string | null
): PortionModifiers['preparationKey'] {
  const foodModifiers = extractPortionModifiers(foodName);
  const matchedModifiers = matchedName ? extractPortionModifiers(matchedName) : null;

  if (!foodModifiers.preparationKey) {
    return null;
  }

  if (matchedModifiers?.preparationKey === foodModifiers.preparationKey) {
    return null;
  }

  return foodModifiers.preparationKey;
}

async function queryExactPortion(normalizedName: string): Promise<PortionReferenceRow | null> {
  const pool = getDbPool();
  const result = await pool.query<PortionReferenceRow>(
    `
      SELECT
        food_name_zh,
        normalized_name_zh,
        default_grams,
        unit_grams,
        size_multipliers,
        preparation_multipliers,
        density_g_per_ml,
        confidence_score,
        reference_source,
        notes,
        priority
      FROM core.portion_reference
      WHERE normalized_name_zh = $1
      ORDER BY priority ASC
      LIMIT 1
    `,
    [normalizedName]
  );
  return result.rows[0] ?? null;
}

async function queryKeywordPortion(normalizedName: string): Promise<PortionKeywordRow[]> {
  const pool = getDbPool();
  const result = await pool.query<PortionKeywordRow>(
    `
      SELECT
        pr.food_name_zh,
        pr.normalized_name_zh,
        pr.default_grams,
        pr.unit_grams,
        pr.size_multipliers,
        pr.preparation_multipliers,
        pr.density_g_per_ml,
        pr.confidence_score,
        pr.reference_source,
        pr.notes,
        pr.priority,
        keyword.keyword AS matched_keyword
      FROM core.portion_reference pr
      JOIN LATERAL unnest(pr.keyword_patterns) keyword(keyword)
        ON position(keyword.keyword in $1) > 0
      ORDER BY pr.priority ASC, char_length(keyword.keyword) DESC
      LIMIT 8
    `,
    [normalizedName]
  );
  return result.rows;
}

function isSafeKeywordPortionMatch(normalizedName: string, keyword: string): boolean {
  const normalizedKeyword = normalizeLookupText(keyword);
  if (!normalizedName || !normalizedKeyword) {
    return false;
  }

  if (normalizedName === normalizedKeyword) {
    return true;
  }

  if (normalizedKeyword.length < 2) {
    return false;
  }

  if (EXACT_MATCH_ONLY_KEYWORDS.has(normalizedKeyword)) {
    return false;
  }

  return (
    normalizedName.startsWith(normalizedKeyword) ||
    normalizedName.endsWith(normalizedKeyword)
  );
}

function shouldUseMatchedNameForPortionLookup(
  foodName: string,
  matchedName?: string | null
): boolean {
  if (!matchedName?.trim()) {
    return false;
  }

  const normalizedFoodName = normalizeLookupText(
    extractPortionModifiers(foodName).baseName || foodName
  );
  const normalizedMatchedName = normalizeLookupText(
    extractPortionModifiers(matchedName).baseName || matchedName
  );

  if (!normalizedFoodName || !normalizedMatchedName) {
    return false;
  }

  if (normalizedFoodName === normalizedMatchedName) {
    return true;
  }

  if (normalizedFoodName.length <= 2 || normalizedMatchedName.length <= 2) {
    return false;
  }

  if (
    normalizedMatchedName.includes(normalizedFoodName) ||
    normalizedFoodName.includes(normalizedMatchedName)
  ) {
    return (
      Math.abs(normalizedMatchedName.length - normalizedFoodName.length) <=
      Math.max(2, Math.floor(Math.min(normalizedMatchedName.length, normalizedFoodName.length) / 2))
    );
  }

  return false;
}

function getFallbackProfile(foodName: string): PortionLookupResult | null {
  const baseName = extractPortionModifiers(foodName).baseName || foodName;
  const matchedFormFactor = FORM_FACTOR_FALLBACK_RULES.find((rule) => rule.pattern.test(baseName));
  if (matchedFormFactor) {
    return buildFallbackPortionResult(foodName, matchedFormFactor.heuristic);
  }

  const category = getNutritionCategory(baseName);
  if (category !== 'unknown') {
    return buildFallbackPortionResult(foodName, CATEGORY_FALLBACK_HEURISTICS[category]);
  }

  return buildFallbackPortionResult(foodName, {
    defaultGrams: 100,
    confidenceScore: 0.45,
    units: {份: 100, 个: 100, 只: 100, 碗: 220, 杯: 250},
    notes: '无法从名称推断明确形态时，使用最保守的 100g 通用份量。',
  });
}

function getPortionLookupCache() {
  if (!global.__fitnessFoodPortionLookupCache) {
    global.__fitnessFoodPortionLookupCache = new Map();
  }

  return global.__fitnessFoodPortionLookupCache;
}

function withPortionLookupCache(
  key: string,
  loader: () => Promise<PortionLookupResult | null>
): Promise<PortionLookupResult | null> {
  const cache = getPortionLookupCache();
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = loader().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, {
    expiresAt: now + PORTION_LOOKUP_CACHE_TTL_MS,
    value,
  });

  if (cache.size > PORTION_LOOKUP_CACHE_MAX_SIZE) {
    for (const [cacheKey, entry] of cache.entries()) {
      if (entry.expiresAt <= now) {
        cache.delete(cacheKey);
      }
      if (cache.size <= PORTION_LOOKUP_CACHE_MAX_SIZE) {
        break;
      }
    }
  }

  return value;
}

export async function lookupPortionReference(
  foodName: string,
  matchedName?: string | null
): Promise<PortionLookupResult | null> {
  const candidateNames = [
    foodName,
    shouldUseMatchedNameForPortionLookup(foodName, matchedName) ? matchedName ?? '' : '',
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  const normalizedCandidates = [...new Set(
    candidateNames.flatMap((candidate) => {
      const modifiers = extractPortionModifiers(candidate);
      return [candidate, modifiers.baseName]
        .map((value) => normalizeLookupText(value))
        .filter(Boolean);
    })
  )];

  const lookupVersion = await getRuntimeLookupVersion('lookup');
  const cacheKey =
    `${lookupVersion}:` +
    (normalizedCandidates.join('|') || normalizeLookupText(matchedName ?? foodName));

  return withPortionLookupCache(cacheKey, async () => {
    try {
      const exactRows = await Promise.all(
        normalizedCandidates.map((candidate) => queryExactPortion(candidate))
      );
      const exact = exactRows.find((row) => row !== null);
      if (exact) {
        return parseRow(exact, 'exact');
      }

      const keywordRows = await Promise.all(
        normalizedCandidates.map((candidate) => queryKeywordPortion(candidate))
      );
      const keyword = keywordRows
        .flatMap((rows, index) =>
          rows.map((row) => ({
            row,
            normalizedCandidate: normalizedCandidates[index] ?? '',
          }))
        )
        .find((candidate) =>
          isSafeKeywordPortionMatch(candidate.normalizedCandidate, candidate.row.matched_keyword)
        )?.row;
      if (keyword) {
        return parseRow(keyword, 'keyword');
      }
    } catch (error) {
      await recordRuntimeError({
        scope: 'portion_reference.lookup',
        code: 'lookup_failed',
        message:
          error instanceof Error
            ? error.message
            : 'portion_reference lookup failed, falling back to in-app heuristic estimation.',
        context: {
          foodName,
          matchedName: matchedName ?? null,
        },
      });
    }

    return getFallbackProfile(matchedName ?? foodName);
  });
}

export async function estimateGrams(
  foodName: string,
  quantityDescription: string,
  matchedName?: string | null
): Promise<{
  grams: number;
  portion: PortionLookupResult | null;
  validationFlags: ValidationFlag[];
  confidenceScore: number;
}> {
  const portion = await lookupPortionReference(foodName, matchedName);
  const validationFlags: ValidationFlag[] = [];
  const modifiers = mergeModifierSources([foodName, matchedName ?? '']);
  const sizeMultiplier =
    (modifiers.sizeKey
      ? portion?.sizeMultipliers[modifiers.sizeKey] ?? DEFAULT_SIZE_MULTIPLIERS[modifiers.sizeKey]
      : 1) ?? 1;
  const preparationMultiplier =
    (modifiers.preparationKey
      ? portion?.preparationMultipliers[modifiers.preparationKey] ??
        DEFAULT_PREPARATION_MULTIPLIERS[modifiers.preparationKey]
      : 1) ?? 1;

  if (modifiers.sizeKey) {
    validationFlags.push('portion_size_adjusted');
  }
  if (modifiers.preparationKey) {
    validationFlags.push('portion_preparation_adjusted');
  }

  if (!quantityDescription || quantityDescription === '未知') {
    if (portion?.matchStrategy === 'exact') {
      validationFlags.push('portion_reference_applied');
    } else if (portion?.matchStrategy === 'keyword') {
      validationFlags.push('portion_keyword_applied');
    } else if (portion?.matchStrategy === 'fallback') {
      validationFlags.push('portion_fallback_applied');
    }

    return {
      grams: Math.max(
        1,
        Math.round((portion?.defaultGrams ?? 100) * sizeMultiplier * preparationMultiplier)
      ),
      portion,
      validationFlags,
      confidenceScore: portion?.confidenceScore ?? 0.55,
    };
  }

  const {count, unit} = parseQuantity(quantityDescription);
  const safeCount = Number.isFinite(count) && count > 0 ? count : 1;

  if (unit && (unit === 'g' || unit === '克')) {
    return {
      grams: Math.max(1, Math.round(safeCount)),
      portion,
      validationFlags,
      confidenceScore: 1,
    };
  }

  if (unit && (unit === 'ml' || unit === '毫升')) {
    const density = portion?.densityGPerMl ?? 1;
    return {
      grams: Math.max(1, Math.round(safeCount * density)),
      portion,
      validationFlags,
      confidenceScore: 1,
    };
  }

  const portionGrams =
    (unit ? portion?.unitGrams[unit] : undefined) ??
    (unit ? GENERIC_UNIT_GRAMS[unit] : undefined) ??
    portion?.defaultGrams ??
    100;

  if (portion?.matchStrategy === 'exact') {
    validationFlags.push('portion_reference_applied');
  } else if (portion?.matchStrategy === 'keyword') {
    validationFlags.push('portion_keyword_applied');
  } else if (portion?.matchStrategy === 'fallback') {
    validationFlags.push('portion_fallback_applied');
  }

  return {
    grams: Math.max(
      1,
      Math.round(safeCount * portionGrams * sizeMultiplier * preparationMultiplier)
    ),
    portion,
    validationFlags,
    confidenceScore: portion?.confidenceScore ?? 0.55,
  };
}

function round(value: number): number {
  return Number(value.toFixed(1));
}

function mergePreparationRules(...rules: Array<PreparationNutritionRule | undefined>): PreparationNutritionRule {
  return rules.reduce<PreparationNutritionRule>(
    (acc, rule) => {
      if (!rule) {
        return acc;
      }

      for (const [fieldKey, value] of Object.entries(rule.multipliers ?? {}) as Array<
        [NutritionFieldKey, number]
      >) {
        acc.multipliers ??= {};
        acc.multipliers[fieldKey] = (acc.multipliers[fieldKey] ?? 1) * value;
      }

      for (const [fieldKey, value] of Object.entries(rule.additives ?? {}) as Array<
        [NutritionFieldKey, number]
      >) {
        acc.additives ??= {};
        acc.additives[fieldKey] = (acc.additives[fieldKey] ?? 0) + value;
      }

      return acc;
    },
    {}
  );
}

function getPreparationNutritionRule(
  preparationKey: string,
  category: NutritionCategory
): PreparationNutritionRule | null {
  const ruleTable = PREPARATION_NUTRITION_RULES[preparationKey];
  if (!ruleTable) {
    return null;
  }

  const mergedRule = mergePreparationRules(
    ruleTable.default,
    category === 'unknown' ? undefined : ruleTable[category]
  );

  return mergedRule.additives || mergedRule.multipliers ? mergedRule : null;
}

function recomputeEnergy(
  profile: NutritionProfile23,
  meta: NutritionProfileMeta23
): {profile: NutritionProfile23; meta: NutritionProfileMeta23} {
  if (
    !isKnownNutritionValue(profile.proteinGrams) ||
    !isKnownNutritionValue(profile.carbohydrateGrams) ||
    !isKnownNutritionValue(profile.fatGrams)
  ) {
    return {profile, meta};
  }

  const nextProfile = createNutritionProfile({
    ...profile,
    energyKcal: round(
      profile.proteinGrams * 4 +
        profile.carbohydrateGrams * 4 +
        profile.fatGrams * 9
    ),
  });
  const nextMeta = cloneNutritionProfileMeta(meta);
  nextMeta.energyKcal = {
    status: 'estimated',
    source: nextMeta.energyKcal.source,
  };

  return {
    profile: nextProfile,
    meta: nextMeta,
  };
}

export function applyPreparationNutritionAdjustments(
  profile: NutritionProfile23,
  meta: NutritionProfileMeta23 | undefined,
  foodName: string,
  matchedName?: string | null
): {profile: NutritionProfile23; meta: NutritionProfileMeta23} {
  const preparationKey = derivePreparationKey(foodName, matchedName);
  if (!preparationKey) {
    return {
      profile,
      meta:
        meta ??
        buildNutritionProfileMeta(profile, {
          knownStatus: 'estimated',
          knownSource: 'mixed',
          missingSource: 'mixed',
        }),
    };
  }

  const category = getNutritionCategory(matchedName ?? foodName);
  const rule = getPreparationNutritionRule(preparationKey, category);
  if (!rule) {
    return {
      profile,
      meta:
        meta ??
        buildNutritionProfileMeta(profile, {
          knownStatus: 'estimated',
          knownSource: 'mixed',
          missingSource: 'mixed',
        }),
    };
  }

  const adjusted = createNutritionProfile(profile);
  const adjustedMeta =
    meta ??
    createNutritionProfileMeta(
      buildNutritionProfileMeta(profile, {
        knownStatus: 'estimated',
        knownSource: 'mixed',
        missingSource: 'mixed',
      })
    );

  for (const [fieldKey, multiplier] of Object.entries(rule.multipliers ?? {}) as Array<
    [NutritionFieldKey, number]
  >) {
    if (!isKnownNutritionValue(adjusted[fieldKey])) {
      continue;
    }

    adjusted[fieldKey] = round(Math.max(0, adjusted[fieldKey]! * multiplier));
    if (adjustedMeta[fieldKey].status !== 'missing') {
      adjustedMeta[fieldKey] = {
        status: 'estimated',
        source: adjustedMeta[fieldKey].source,
      };
    }
  }

  for (const [fieldKey, delta] of Object.entries(rule.additives ?? {}) as Array<
    [NutritionFieldKey, number]
  >) {
    if (!isKnownNutritionValue(adjusted[fieldKey])) {
      continue;
    }

    adjusted[fieldKey] = round(Math.max(0, adjusted[fieldKey]! + delta));
    if (adjustedMeta[fieldKey].status !== 'missing') {
      adjustedMeta[fieldKey] = {
        status: 'estimated',
        source: adjustedMeta[fieldKey].source,
      };
    }
  }

  return recomputeEnergy(adjusted, adjustedMeta);
}
