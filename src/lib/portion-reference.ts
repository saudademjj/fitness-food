import {getDbPool} from '@/lib/db';
import {normalizeLookupText, parseQuantity} from '@/lib/food-text';
import {
  createNutritionProfile,
  type NutritionFieldKey,
  type NutritionProfile23,
} from '@/lib/nutrition-profile';
import type {ValidationFlag} from '@/lib/validation';

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

type PortionModifiers = {
  baseName: string;
  sizeKey: string | null;
  preparationKey: string | null;
};

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

const DEFAULT_PREPARATION_NUTRITION_MULTIPLIERS: Record<
  string,
  Partial<Record<NutritionFieldKey, number>>
> = {
  生: {},
  熟: {
    proteinGrams: 0.99,
    fatGrams: 0.98,
  },
  煮: {
    proteinGrams: 0.98,
    fatGrams: 0.97,
    sodiumMg: 1.02,
  },
  蒸: {
    proteinGrams: 0.99,
    fatGrams: 0.96,
  },
  炒: {
    fatGrams: 1.16,
    sodiumMg: 1.08,
  },
  炸: {
    carbohydrateGrams: 1.04,
    fatGrams: 1.35,
    sodiumMg: 1.1,
  },
  烤: {
    fatGrams: 1.08,
    sodiumMg: 1.04,
  },
  炖: {
    fatGrams: 1.05,
    sodiumMg: 1.06,
  },
  汤: {
    proteinGrams: 0.72,
    carbohydrateGrams: 0.88,
    fatGrams: 0.62,
    sodiumMg: 1.12,
    potassiumMg: 0.84,
    calciumMg: 0.9,
    ironMg: 0.82,
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

const FALLBACK_PROFILES: Array<{
  keywords: RegExp;
  defaultGrams: number;
  confidenceScore: number;
  units?: Partial<Record<string, number>>;
  densityGPerMl?: number;
  sizeMultipliers?: Partial<Record<string, number>>;
  preparationMultipliers?: Partial<Record<string, number>>;
}> = [
  {
    keywords: /包子|肉包|菜包|叉烧包|流沙包/i,
    defaultGrams: 110,
    confidenceScore: 0.84,
    units: {个: 110, 只: 110},
  },
  {
    keywords: /小笼包/i,
    defaultGrams: 35,
    confidenceScore: 0.9,
    units: {个: 35, 只: 35},
  },
  {
    keywords: /豆浆/i,
    defaultGrams: 300,
    confidenceScore: 0.92,
    units: {杯: 300, 碗: 300, 盒: 250, 瓶: 300, ml: 1.02, 毫升: 1.02},
    densityGPerMl: 1.02,
  },
  {
    keywords: /牛奶|酸奶/i,
    defaultGrams: 250,
    confidenceScore: 0.9,
    units: {杯: 250, 盒: 250, 瓶: 250, ml: 1.03, 毫升: 1.03},
    densityGPerMl: 1.03,
  },
  {
    keywords: /可乐|雪碧|芬达|汽水|饮料/i,
    defaultGrams: 330,
    confidenceScore: 0.88,
    units: {罐: 330, 瓶: 500, 杯: 330, ml: 1, 毫升: 1},
    densityGPerMl: 1,
  },
  {
    keywords: /奶茶|果汁|咖啡/i,
    defaultGrams: 500,
    confidenceScore: 0.82,
    units: {杯: 500, 瓶: 500, ml: 1.01, 毫升: 1.01},
    densityGPerMl: 1.01,
  },
  {
    keywords: /米饭|白饭/i,
    defaultGrams: 180,
    confidenceScore: 0.94,
    units: {碗: 180, 份: 180},
  },
  {
    keywords: /炒饭|盖饭|焗饭|便当/i,
    defaultGrams: 320,
    confidenceScore: 0.8,
    units: {盘: 320, 份: 320, 碗: 300},
    preparationMultipliers: {炒: 1.08},
  },
  {
    keywords: /面条|拌面|炒面|拉面|刀削面|炸酱面|热干面/i,
    defaultGrams: 320,
    confidenceScore: 0.82,
    units: {碗: 320, 份: 320},
  },
  {
    keywords: /米线|河粉|粉丝|粉条|酸辣粉/i,
    defaultGrams: 380,
    confidenceScore: 0.8,
    units: {碗: 380, 份: 380},
  },
  {
    keywords: /螺蛳粉/i,
    defaultGrams: 450,
    confidenceScore: 0.84,
    units: {碗: 450, 份: 450},
  },
  {
    keywords: /肠粉/i,
    defaultGrams: 250,
    confidenceScore: 0.9,
    units: {份: 250, 盘: 250},
  },
  {
    keywords: /煎饼果子|煎饼馃子/i,
    defaultGrams: 280,
    confidenceScore: 0.9,
    units: {份: 280, 个: 280},
  },
  {
    keywords: /粥|白粥|小米粥|南瓜粥/i,
    defaultGrams: 300,
    confidenceScore: 0.9,
    units: {碗: 300, 杯: 300},
  },
  {
    keywords: /汤|排骨汤|蛋花汤|紫菜蛋花汤/i,
    defaultGrams: 380,
    confidenceScore: 0.78,
    units: {碗: 380, 份: 380},
    preparationMultipliers: {汤: 1.18},
  },
  {
    keywords: /麻辣烫/i,
    defaultGrams: 650,
    confidenceScore: 0.72,
    units: {份: 650, 碗: 650, 盒: 700},
    preparationMultipliers: {汤: 1.18},
  },
  {
    keywords: /火锅/i,
    defaultGrams: 700,
    confidenceScore: 0.65,
    units: {份: 700, 锅: 900},
    preparationMultipliers: {汤: 1.2},
  },
  {
    keywords: /鸡蛋|茶叶蛋|卤蛋|煮蛋|蒸蛋|炒蛋/i,
    defaultGrams: 50,
    confidenceScore: 0.95,
    units: {个: 50, 只: 50, 颗: 50},
  },
  {
    keywords: /馒头/i,
    defaultGrams: 100,
    confidenceScore: 0.92,
    units: {个: 100, 只: 100},
  },
  {
    keywords: /面包|吐司|法棍/i,
    defaultGrams: 80,
    confidenceScore: 0.8,
    units: {片: 30, 个: 80, 只: 80},
  },
  {
    keywords: /鸡胸肉|鸡腿|鸡翅|鸡肉/i,
    defaultGrams: 150,
    confidenceScore: 0.84,
    units: {块: 150, 片: 100, 份: 150, 个: 85, 只: 85},
    preparationMultipliers: {炸: 0.9, 烤: 0.88, 炒: 1.05},
  },
  {
    keywords: /牛排|牛肉|羊肉|猪肉|排骨/i,
    defaultGrams: 160,
    confidenceScore: 0.82,
    units: {块: 160, 片: 120, 份: 160},
    preparationMultipliers: {炸: 0.92, 烤: 0.9, 炒: 1.06, 炖: 1.1},
  },
  {
    keywords: /鱼排|鱼肉|虾|三文鱼|鳕鱼/i,
    defaultGrams: 150,
    confidenceScore: 0.82,
    units: {块: 150, 片: 120, 份: 150, 串: 35},
    preparationMultipliers: {炸: 0.9, 烤: 0.88, 蒸: 0.95},
  },
  {
    keywords: /宫保鸡丁|番茄炒蛋|红烧肉|回锅肉|麻婆豆腐|鱼香肉丝/i,
    defaultGrams: 220,
    confidenceScore: 0.84,
    units: {份: 220, 盘: 220},
    preparationMultipliers: {炒: 1.08, 炖: 1.1},
  },
  {
    keywords: /披萨/i,
    defaultGrams: 320,
    confidenceScore: 0.9,
    units: {份: 320, 片: 120, 块: 120},
  },
  {
    keywords: /汉堡|三明治|卷饼/i,
    defaultGrams: 220,
    confidenceScore: 0.86,
    units: {个: 220, 份: 220, 只: 220},
  },
  {
    keywords: /蛋糕|芝士蛋糕|慕斯蛋糕/i,
    defaultGrams: 90,
    confidenceScore: 0.9,
    units: {块: 90, 片: 90, 份: 100},
  },
  {
    keywords: /蛋挞|葡式蛋挞/i,
    defaultGrams: 55,
    confidenceScore: 0.92,
    units: {个: 55, 只: 55},
  },
  {
    keywords: /饺子|水饺|煎饺|锅贴/i,
    defaultGrams: 25,
    confidenceScore: 0.86,
    units: {个: 25, 只: 25},
  },
  {
    keywords: /馄饨/i,
    defaultGrams: 18,
    confidenceScore: 0.84,
    units: {个: 18, 只: 18, 碗: 240},
  },
  {
    keywords: /油条|麻花/i,
    defaultGrams: 55,
    confidenceScore: 0.9,
    units: {根: 55, 条: 55},
  },
  {
    keywords: /苹果|梨|橙子|桃子|芒果|猕猴桃|香蕉/i,
    defaultGrams: 180,
    confidenceScore: 0.88,
    units: {个: 180, 只: 180, 根: 120},
  },
  {
    keywords: /西瓜|哈密瓜|菠萝/i,
    defaultGrams: 250,
    confidenceScore: 0.78,
    units: {块: 250, 片: 180},
  },
  {
    keywords: /玉米|红薯|土豆/i,
    defaultGrams: 200,
    confidenceScore: 0.82,
    units: {根: 180, 个: 200, 只: 200, 块: 100},
  },
  {
    keywords: /烤羊肉串|牛肉串|鸡肉串|羊肉串/i,
    defaultGrams: 35,
    confidenceScore: 0.9,
    units: {串: 35, 根: 35},
    preparationMultipliers: {烤: 0.88},
  },
  {
    keywords: /炸鸡块|鸡块|麦乐鸡/i,
    defaultGrams: 45,
    confidenceScore: 0.88,
    units: {块: 45, 个: 45, 份: 270},
    preparationMultipliers: {炸: 0.9},
  },
  {
    keywords: /薯条/i,
    defaultGrams: 110,
    confidenceScore: 0.9,
    units: {份: 110, 包: 110},
    preparationMultipliers: {炸: 0.9},
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

async function queryKeywordPortion(normalizedName: string): Promise<PortionReferenceRow | null> {
  const pool = getDbPool();
  const result = await pool.query<PortionReferenceRow>(
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
        pr.priority
      FROM core.portion_reference pr
      JOIN LATERAL unnest(pr.keyword_patterns) keyword(keyword) ON $1 LIKE '%' || keyword || '%'
      ORDER BY pr.priority ASC, char_length(keyword.keyword) DESC
      LIMIT 1
    `,
    [normalizedName]
  );
  return result.rows[0] ?? null;
}

function getFallbackProfile(foodName: string): PortionLookupResult | null {
  const matched = FALLBACK_PROFILES.find((profile) => profile.keywords.test(foodName));
  if (!matched) {
    return null;
  }

  const unitGrams = sanitizeNumberRecord(matched.units ?? {});

  return {
    matchedName: foodName,
    defaultGrams: matched.defaultGrams,
    unitGrams,
    sizeMultipliers: sanitizeNumberRecord({
      ...DEFAULT_SIZE_MULTIPLIERS,
      ...(matched.sizeMultipliers ?? {}),
    }),
    preparationMultipliers: sanitizeNumberRecord({
      ...DEFAULT_PREPARATION_MULTIPLIERS,
      ...(matched.preparationMultipliers ?? {}),
    }),
    densityGPerMl: matched.densityGPerMl ?? null,
    confidenceScore: matched.confidenceScore,
    sourceLabel: '应用内回退份量表',
    notes: null,
    matchStrategy: 'fallback',
  };
}

export async function lookupPortionReference(
  foodName: string,
  matchedName?: string | null
): Promise<PortionLookupResult | null> {
  const candidateNames = [foodName, matchedName ?? '']
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

  try {
    const exactRows = await Promise.all(normalizedCandidates.map((candidate) => queryExactPortion(candidate)));
    const exact = exactRows.find((row) => row !== null);
    if (exact) {
      return parseRow(exact, 'exact');
    }

    const keywordRows = await Promise.all(
      normalizedCandidates.map((candidate) => queryKeywordPortion(candidate))
    );
    const keyword = keywordRows.find((row) => row !== null);
    if (keyword) {
      return parseRow(keyword, 'keyword');
    }
  } catch {
    // Keep runtime resilient before the migration is applied.
  }

  return getFallbackProfile(matchedName ?? foodName);
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

function recomputeEnergy(profile: NutritionProfile23): NutritionProfile23 {
  return createNutritionProfile({
    ...profile,
    energyKcal: round(
      profile.proteinGrams * 4 +
        profile.carbohydrateGrams * 4 +
        profile.fatGrams * 9
    ),
  });
}

export function applyPreparationNutritionAdjustments(
  profile: NutritionProfile23,
  foodName: string,
  matchedName?: string | null
): NutritionProfile23 {
  const preparationKey = derivePreparationKey(foodName, matchedName);
  if (!preparationKey) {
    return profile;
  }

  const multipliers = DEFAULT_PREPARATION_NUTRITION_MULTIPLIERS[preparationKey];
  if (!multipliers) {
    return profile;
  }

  const adjusted = createNutritionProfile(profile);
  for (const [fieldKey, multiplier] of Object.entries(multipliers) as Array<
    [NutritionFieldKey, number]
  >) {
    adjusted[fieldKey] = round(adjusted[fieldKey] * multiplier);
  }

  return recomputeEnergy(adjusted);
}
