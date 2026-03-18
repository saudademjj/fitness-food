import {getDbPool} from '@/lib/db';
import type {MatchMode, SourceStatus, ValidationFlag} from '@/lib/food-contract';
import {
  DANGEROUS_SUFFIX_PATTERN,
  UNSAFE_FUZZY_MATCH_PATTERN,
  normalizeLookupText,
  sanitizeFoodName,
} from '@/lib/food-text';
import {recordLookupMiss} from '@/lib/miss-telemetry';
import {recordRuntimeError} from '@/lib/runtime-observability';
import {getRuntimeLookupVersion} from '@/lib/runtime-cache-version';
import {
  NON_CORE_NUTRITION_KEYS,
  buildNutritionProfileMeta,
  createNutritionProfile,
  createNutritionProfileMeta,
  normalizeNutritionValue,
  type NutritionFieldKey,
  type NutritionProfile23,
  type NutritionProfileMeta23,
} from '@/lib/nutrition-profile';
import {
  dedupeValidationFlags,
  getNutritionCategory,
  validateMacroNutrients,
  type MacroValidationIssue,
} from '@/lib/validation';

type SourceKind = 'recipe' | 'catalog';
type FuzzyStrategyKind = 'alias' | 'catalog';
type LookupMode = 'exact' | 'auto';
type CuratedBrandOverrideDefinition = {
  names: string[];
  matchedName: string;
  per100g: NutritionProfile23;
};
type EvaluatedLookupCandidate = {
  result: NutritionLookupResult;
  rejected: boolean;
  issues: MacroValidationIssue[];
  rejectionFlags: ValidationFlag[];
};

declare global {
  // eslint-disable-next-line no-var
  var __fitnessFoodNutritionLookupCache:
    | Map<string, {expiresAt: number; value: Promise<NutritionLookupResult | null>}>
    | undefined;
}

const NUTRITION_LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;
const NUTRITION_LOOKUP_CACHE_MAX_SIZE = 1024;
const DB_VALIDATION_EXEMPTION_PATTERN =
  /(伏特加|威士忌|朗姆酒|白兰地|龙舌兰|金酒|蒸馏酒|酒精饮料|代糖|甜味剂|甜菊|甜叶菊|罗汉果|阿斯巴甜|赤藓糖醇|sucralose|sweetener|蛋白粉|乳清蛋白|protein powder|whey protein|代餐粉|增肌粉)/i;
const DB_STRICT_VALIDATION_PATTERN =
  /(可口可乐|可乐|雪碧|芬达|汽水|苏打|气泡水|奶茶|果汁|咖啡|拿铁|美式|乌龙|麦乐鸡|鸡块|薯条|汉堡|披萨|三明治|卷饼|蛋糕|蛋挞|炒饭|盖饭|米饭|面条|拉面|拌面|粥|包子|馒头|饺子|汤圆)/i;

const CURATED_BRAND_OVERRIDES: CuratedBrandOverrideDefinition[] = [
  {
    names: ['可口可乐', 'cocacola', 'coca-cola'],
    matchedName: '可口可乐',
    per100g: createNutritionProfile({
      energyKcal: 42,
      proteinGrams: 0,
      carbohydrateGrams: 10.36,
      fatGrams: 0.25,
      fiberGrams: 0,
      sugarsGrams: 9.94,
      sodiumMg: 3,
      potassiumMg: 5,
      calciumMg: 1,
      magnesiumMg: 0,
      ironMg: 0.02,
      zincMg: 0.09,
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
    }),
  },
  {
    names: ['麦乐鸡', '麦当劳麦乐鸡', 'mcnugget', 'mcnuggets'],
    matchedName: '麦乐鸡',
    per100g: createNutritionProfile({
      energyKcal: 266.3,
      proteinGrams: 15,
      carbohydrateGrams: 16.3,
      fatGrams: 15,
    }),
  },
];

const SELECT_COLUMNS = `
  ac.entity_type,
  ac.entity_id,
  ac.entity_slug,
  ac.food_name_zh,
  ac.food_name_en,
  ac.source_system,
  ac.source_item_id,
  ac.food_group,
  ac.source_category,
  ac.source_subcategory,
  ac.energy_kcal,
  ac.protein_grams,
  ac.carbohydrate_grams,
  ac.fat_grams,
  ac.fiber_grams,
  ac.sugars_grams,
  ac.sodium_mg,
  ac.potassium_mg,
  ac.calcium_mg,
  ac.magnesium_mg,
  ac.iron_mg,
  ac.zinc_mg,
  ac.vitamin_a_mcg,
  ac.vitamin_c_mg,
  ac.vitamin_d_mcg,
  ac.vitamin_e_mg,
  ac.vitamin_k_mcg,
  ac.thiamin_mg,
  ac.riboflavin_mg,
  ac.niacin_mg,
  ac.vitamin_b6_mg,
  ac.vitamin_b12_mcg,
  ac.folate_mcg,
  ac.energy_kcal_is_present,
  ac.protein_grams_is_present,
  ac.carbohydrate_grams_is_present,
  ac.fat_grams_is_present,
  ac.fiber_grams_is_present,
  ac.sugars_grams_is_present,
  ac.sodium_mg_is_present,
  ac.potassium_mg_is_present,
  ac.calcium_mg_is_present,
  ac.magnesium_mg_is_present,
  ac.iron_mg_is_present,
  ac.zinc_mg_is_present,
  ac.vitamin_a_mcg_is_present,
  ac.vitamin_c_mg_is_present,
  ac.vitamin_d_mcg_is_present,
  ac.vitamin_e_mg_is_present,
  ac.vitamin_k_mcg_is_present,
  ac.thiamin_mg_is_present,
  ac.riboflavin_mg_is_present,
  ac.niacin_mg_is_present,
  ac.vitamin_b6_mg_is_present,
  ac.vitamin_b12_mcg_is_present,
  ac.folate_mcg_is_present,
  ac.amount_basis_g,
  ac.publish_ready,
  ac.completeness_ratio,
  ac.macro_present_count,
  ac.non_core_present_count,
  ac.measured_nutrient_count
`;

const CORE_MACRO_FILTER = `
  COALESCE(ac.energy_kcal_is_present, FALSE) = TRUE
  AND COALESCE(ac.protein_grams_is_present, FALSE) = TRUE
  AND COALESCE(ac.carbohydrate_grams_is_present, FALSE) = TRUE
  AND COALESCE(ac.fat_grams_is_present, FALSE) = TRUE
`;

const EXACT_LOOKUP_READY_FILTER = `
  (
    ac.publish_ready = TRUE
    OR (
      COALESCE(ac.macro_present_count, 0) = 4
      AND COALESCE(ac.measured_nutrient_count, 0) >= 4
    )
  )
`;

const FUZZY_LOOKUP_READY_FILTER = `
  (
    ac.publish_ready = TRUE
    OR (
      COALESCE(ac.completeness_ratio, 0) >= 0.4
      AND COALESCE(ac.macro_present_count, 0) = 4
      AND COALESCE(ac.measured_nutrient_count, 0) >= 6
    )
  )
`;

const ANATOMY_TAILS = [
  '鸡蛋',
  '鸡翅',
  '鸡腿',
  '鸡心',
  '鸡胸',
  '鸡爪',
  '鸭腿',
  '鸭翅',
  '牛腩',
  '牛排',
  '猪肝',
  '排骨',
  '里脊',
  '火腿',
  '香肠',
] as const;

const SHORT_NAME_SEMANTIC_TAILS = [
  '肉',
  '肝',
  '蛋',
  '腿',
  '翅',
  '胸',
  '心',
  '爪',
  '排',
  '腩',
  '肠',
  '骨',
  '丸',
  '鱼',
  '虾',
  '蟹',
] as const;

const LOOKUP_SYNONYM_GROUPS = [
  ['辣椒', '青椒', '尖椒', '甜椒', '彩椒'],
  ['番茄', '西红柿'],
  ['土豆', '马铃薯'],
  ['香菜', '芫荽'],
  ['豆腐皮', '千张'],
  ['玉米粒', '玉米'],
  ['猪肉末', '猪肉馅', '猪肉'],
  ['牛肉末', '牛肉馅', '牛肉'],
  ['鸡肉末', '鸡肉馅', '鸡肉'],
] as const;

const ROW_FIELD_MAP = [
  {profileKey: 'energyKcal', valueKey: 'energy_kcal', presentKey: 'energy_kcal_is_present'},
  {
    profileKey: 'proteinGrams',
    valueKey: 'protein_grams',
    presentKey: 'protein_grams_is_present',
  },
  {
    profileKey: 'carbohydrateGrams',
    valueKey: 'carbohydrate_grams',
    presentKey: 'carbohydrate_grams_is_present',
  },
  {profileKey: 'fatGrams', valueKey: 'fat_grams', presentKey: 'fat_grams_is_present'},
  {profileKey: 'fiberGrams', valueKey: 'fiber_grams', presentKey: 'fiber_grams_is_present'},
  {profileKey: 'sugarsGrams', valueKey: 'sugars_grams', presentKey: 'sugars_grams_is_present'},
  {profileKey: 'sodiumMg', valueKey: 'sodium_mg', presentKey: 'sodium_mg_is_present'},
  {profileKey: 'potassiumMg', valueKey: 'potassium_mg', presentKey: 'potassium_mg_is_present'},
  {profileKey: 'calciumMg', valueKey: 'calcium_mg', presentKey: 'calcium_mg_is_present'},
  {
    profileKey: 'magnesiumMg',
    valueKey: 'magnesium_mg',
    presentKey: 'magnesium_mg_is_present',
  },
  {profileKey: 'ironMg', valueKey: 'iron_mg', presentKey: 'iron_mg_is_present'},
  {profileKey: 'zincMg', valueKey: 'zinc_mg', presentKey: 'zinc_mg_is_present'},
  {
    profileKey: 'vitaminAMcg',
    valueKey: 'vitamin_a_mcg',
    presentKey: 'vitamin_a_mcg_is_present',
  },
  {
    profileKey: 'vitaminCMg',
    valueKey: 'vitamin_c_mg',
    presentKey: 'vitamin_c_mg_is_present',
  },
  {
    profileKey: 'vitaminDMcg',
    valueKey: 'vitamin_d_mcg',
    presentKey: 'vitamin_d_mcg_is_present',
  },
  {
    profileKey: 'vitaminEMg',
    valueKey: 'vitamin_e_mg',
    presentKey: 'vitamin_e_mg_is_present',
  },
  {
    profileKey: 'vitaminKMcg',
    valueKey: 'vitamin_k_mcg',
    presentKey: 'vitamin_k_mcg_is_present',
  },
  {profileKey: 'thiaminMg', valueKey: 'thiamin_mg', presentKey: 'thiamin_mg_is_present'},
  {
    profileKey: 'riboflavinMg',
    valueKey: 'riboflavin_mg',
    presentKey: 'riboflavin_mg_is_present',
  },
  {profileKey: 'niacinMg', valueKey: 'niacin_mg', presentKey: 'niacin_mg_is_present'},
  {
    profileKey: 'vitaminB6Mg',
    valueKey: 'vitamin_b6_mg',
    presentKey: 'vitamin_b6_mg_is_present',
  },
  {
    profileKey: 'vitaminB12Mcg',
    valueKey: 'vitamin_b12_mcg',
    presentKey: 'vitamin_b12_mcg_is_present',
  },
  {profileKey: 'folateMcg', valueKey: 'folate_mcg', presentKey: 'folate_mcg_is_present'},
] as const satisfies Array<{
  profileKey: NutritionFieldKey;
  valueKey: keyof CatalogRow;
  presentKey: keyof CatalogRow;
}>;

export type CatalogRow = {
  entity_type: 'food' | 'recipe';
  entity_id: string | null;
  entity_slug: string | null;
  food_name_zh: string | null;
  food_name_en: string | null;
  source_system: string;
  source_item_id: string | null;
  food_group: string | null;
  source_category: string | null;
  source_subcategory: string | null;
  energy_kcal: number | null;
  protein_grams: number | null;
  carbohydrate_grams: number | null;
  fat_grams: number | null;
  fiber_grams: number | null;
  sugars_grams: number | null;
  sodium_mg: number | null;
  potassium_mg: number | null;
  calcium_mg: number | null;
  magnesium_mg: number | null;
  iron_mg: number | null;
  zinc_mg: number | null;
  vitamin_a_mcg: number | null;
  vitamin_c_mg: number | null;
  vitamin_d_mcg: number | null;
  vitamin_e_mg: number | null;
  vitamin_k_mcg: number | null;
  thiamin_mg: number | null;
  riboflavin_mg: number | null;
  niacin_mg: number | null;
  vitamin_b6_mg: number | null;
  vitamin_b12_mcg: number | null;
  folate_mcg: number | null;
  energy_kcal_is_present: boolean | null;
  protein_grams_is_present: boolean | null;
  carbohydrate_grams_is_present: boolean | null;
  fat_grams_is_present: boolean | null;
  fiber_grams_is_present: boolean | null;
  sugars_grams_is_present: boolean | null;
  sodium_mg_is_present: boolean | null;
  potassium_mg_is_present: boolean | null;
  calcium_mg_is_present: boolean | null;
  magnesium_mg_is_present: boolean | null;
  iron_mg_is_present: boolean | null;
  zinc_mg_is_present: boolean | null;
  vitamin_a_mcg_is_present: boolean | null;
  vitamin_c_mg_is_present: boolean | null;
  vitamin_d_mcg_is_present: boolean | null;
  vitamin_e_mg_is_present: boolean | null;
  vitamin_k_mcg_is_present: boolean | null;
  thiamin_mg_is_present: boolean | null;
  riboflavin_mg_is_present: boolean | null;
  niacin_mg_is_present: boolean | null;
  vitamin_b6_mg_is_present: boolean | null;
  vitamin_b12_mcg_is_present: boolean | null;
  folate_mcg_is_present: boolean | null;
  amount_basis_g: number | null;
  publish_ready: boolean;
  completeness_ratio: number | null;
  macro_present_count: number | null;
  non_core_present_count: number | null;
  measured_nutrient_count: number | null;
  fuzzy_score?: number | null;
  lookup_alias_text?: string | null;
};

export type NutritionLookupResult = {
  sourceKind: SourceKind;
  sourceLabel: string;
  matchedName: string;
  entityId: string | null;
  entitySlug: string | null;
  sourceItemId: string | null;
  foodGroup: string | null;
  sourceCategory: string | null;
  sourceSubcategory: string | null;
  per100g: NutritionProfile23;
  per100gMeta: NutritionProfileMeta23;
  amountBasisG: number;
  matchMode: MatchMode;
  sourceStatus: SourceStatus;
  validationFlags: ValidationFlag[];
  measuredNutrientCount: number;
  missingFieldKeys: NutritionFieldKey[];
};

export type NutritionLookupResolver = (
  foodName: string,
  options?: {allowFuzzy?: boolean; recordMiss?: boolean}
) => Promise<NutritionLookupResult | null>;

function getCuratedBrandOverrideDefinition(variants: string[]): CuratedBrandOverrideDefinition | null {
  const normalizedVariants = new Set(variants.map((variant) => normalizeLookupText(variant)));
  return (
    CURATED_BRAND_OVERRIDES.find((definition) =>
      definition.names.some((name) => normalizedVariants.has(normalizeLookupText(name)))
    ) ?? null
  );
}

function createCuratedBrandLookupResult(
  definition: CuratedBrandOverrideDefinition,
  extraFlags: ValidationFlag[] = []
): NutritionLookupResult {
  const per100gMeta = buildNutritionProfileMeta(definition.per100g, {
    knownStatus: 'measured',
    knownSource: 'database',
    missingSource: 'database',
  });
  const missingFieldKeys = NON_CORE_NUTRITION_KEYS.filter(
    (key) => per100gMeta[key].status === 'missing'
  );

  return {
    sourceKind: 'catalog',
    sourceLabel: `品牌营养覆盖 · ${definition.matchedName}`,
    matchedName: definition.matchedName,
    entityId: null,
    entitySlug: null,
    sourceItemId: null,
    foodGroup: 'brand_override',
    sourceCategory: 'brand_override',
    sourceSubcategory: null,
    per100g: definition.per100g,
    per100gMeta,
    amountBasisG: 100,
    matchMode: 'exact',
    sourceStatus: 'published',
    validationFlags: dedupeValidationFlags([
      'brand_curated_override',
      ...extraFlags,
      ...(missingFieldKeys.length ? (['db_micronutrient_gap', 'nutrition_partial'] as const) : []),
    ]),
    measuredNutrientCount: 4 + (NON_CORE_NUTRITION_KEYS.length - missingFieldKeys.length),
    missingFieldKeys,
  };
}

function shouldBypassStrictDbValidation(
  matchedName: string,
  row: CatalogRow,
  profile: NutritionProfile23
): boolean {
  const searchableText = [matchedName, row.food_name_en ?? '', row.source_category ?? '']
    .join(' ')
    .trim();

  if (DB_VALIDATION_EXEMPTION_PATTERN.test(searchableText)) {
    return true;
  }

  const isLikelyZeroCalorieItem =
    (profile.energyKcal ?? 0) <= 5 &&
    (profile.carbohydrateGrams ?? 0) <= 1.5 &&
    (profile.fatGrams ?? 0) <= 1 &&
    (profile.proteinGrams ?? 0) <= 1.5;

  if (
    isLikelyZeroCalorieItem &&
    /(无糖|零度|zero|diet|light|低热量|低卡|气泡水|苏打|可乐|饮料|茶|咖啡)/i.test(searchableText)
  ) {
    return true;
  }

  return false;
}

function shouldApplyStrictDbValidation(
  foodName: string,
  row: CatalogRow,
  profile: NutritionProfile23
): boolean {
  const matchedName = row.food_name_zh ?? row.food_name_en ?? foodName;
  if (shouldBypassStrictDbValidation(matchedName, row, profile)) {
    return false;
  }

  const searchableText = [
    matchedName,
    row.food_name_en ?? '',
    row.source_category ?? '',
    row.source_subcategory ?? '',
    row.source_system,
  ]
    .join(' ')
    .trim();
  const category = getNutritionCategory(matchedName);

  return (
    category === 'beverage' ||
    category === 'staple' ||
    category === 'mixed_dish' ||
    category === 'protein_food' ||
    category === 'dessert_snack' ||
    DB_STRICT_VALIDATION_PATTERN.test(searchableText) ||
    (row.source_system === 'open_food_facts' && /[\u4e00-\u9fff]/u.test(matchedName))
  );
}

function evaluateLookupCandidate(
  foodName: string,
  row: CatalogRow,
  matchMode: MatchMode
): EvaluatedLookupCandidate {
  const result = mapRowToLookupResult(row, matchMode);
  const matchedName = result.matchedName || foodName;

  if (!shouldApplyStrictDbValidation(matchedName, row, result.per100g)) {
    return {
      result,
      rejected: false,
      issues: [],
      rejectionFlags: [],
    };
  }

  const issues = validateMacroNutrients(result.per100g, 0.12, matchedName);
  const rejected =
    issues.includes('thermodynamic_mismatch') ||
    issues.includes('sugars_exceed_carbohydrate') ||
    issues.includes('category_mismatch');
  const rejectionFlags: ValidationFlag[] = [];

  if (rejected) {
    rejectionFlags.push('db_candidate_rejected');
  }
  if (issues.includes('thermodynamic_mismatch')) {
    rejectionFlags.push('db_candidate_thermodynamic_mismatch');
  }

  return {
    result: {
      ...result,
      validationFlags: dedupeValidationFlags([
        ...result.validationFlags,
        ...rejectionFlags,
      ]),
    },
    rejected,
    issues,
    rejectionFlags,
  };
}

function selectBestLookupCandidate(
  foodName: string,
  rows: CatalogRow[],
  matchMode: MatchMode
): {result: NutritionLookupResult | null; rejectionFlags: ValidationFlag[]} {
  const evaluated = rows.map((row) => evaluateLookupCandidate(foodName, row, matchMode));
  const accepted = evaluated.find((candidate) => !candidate.rejected);
  const rejectionFlags = dedupeValidationFlags(
    evaluated.flatMap((candidate) => candidate.rejectionFlags)
  );

  return {
    result: accepted
      ? {
          ...accepted.result,
          validationFlags: dedupeValidationFlags([
            ...accepted.result.validationFlags,
            ...rejectionFlags,
          ]),
        }
      : null,
    rejectionFlags,
  };
}

function getNutritionLookupCache() {
  if (!global.__fitnessFoodNutritionLookupCache) {
    global.__fitnessFoodNutritionLookupCache = new Map();
  }

  return global.__fitnessFoodNutritionLookupCache;
}

function withNutritionLookupCache(
  key: string,
  loader: () => Promise<NutritionLookupResult | null>
): Promise<NutritionLookupResult | null> {
  const cache = getNutritionLookupCache();
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
    expiresAt: now + NUTRITION_LOOKUP_CACHE_TTL_MS,
    value,
  });

  if (cache.size > NUTRITION_LOOKUP_CACHE_MAX_SIZE) {
    for (const [cacheKey, entry] of cache.entries()) {
      if (entry.expiresAt <= now) {
        cache.delete(cacheKey);
      }
      if (cache.size <= NUTRITION_LOOKUP_CACHE_MAX_SIZE) {
        break;
      }
    }
  }

  return value;
}

function buildPer100gProfile(
  row: CatalogRow,
  amountBasisG: number
): {profile: NutritionProfile23; meta: NutritionProfileMeta23} {
  const profile = createNutritionProfile();
  const meta = createNutritionProfileMeta();

  for (const field of ROW_FIELD_MAP) {
    const normalizedValue = normalizeNutritionValue(
      row[field.valueKey] as number | null,
      amountBasisG
    );
    const isPresent = row[field.presentKey] === true;

    profile[field.profileKey] = normalizedValue;
    meta[field.profileKey] =
      isPresent && normalizedValue !== null
        ? {status: 'measured', source: 'database'}
        : {status: 'missing', source: 'database'};
  }

  return {profile, meta};
}

export function mapRowToLookupResult(
  row: CatalogRow,
  matchMode: MatchMode
): NutritionLookupResult {
  const matchedName = row.food_name_zh ?? row.food_name_en ?? '未知食物';
  const sourceKind: SourceKind = row.entity_type === 'recipe' ? 'recipe' : 'catalog';
  const sourceStatus: SourceStatus = row.publish_ready ? 'published' : 'preview';
  const amountBasisG =
    Number.isFinite(row.amount_basis_g) && (row.amount_basis_g ?? 0) > 0
      ? Number(row.amount_basis_g)
      : 100;
  const {profile, meta} = buildPer100gProfile(row, amountBasisG);
  const missingFieldKeys = NON_CORE_NUTRITION_KEYS.filter(
    (key) => meta[key].status === 'missing'
  );
  const validationFlags: ValidationFlag[] = [];

  if (missingFieldKeys.length) {
    validationFlags.push('db_micronutrient_gap', 'nutrition_partial');
  }

  return {
    sourceKind,
    sourceLabel:
      sourceKind === 'recipe'
        ? `${sourceStatus === 'preview' ? '候选食谱' : '标准食谱'} · ${matchedName}`
        : `${sourceStatus === 'preview' ? '候选营养库' : '标准营养库'} · ${matchedName}`,
    matchedName,
    entityId: row.entity_id,
    entitySlug: row.entity_slug,
    sourceItemId: row.source_item_id,
    foodGroup: row.food_group,
    sourceCategory: row.source_category,
    sourceSubcategory: row.source_subcategory,
    amountBasisG,
    matchMode,
    sourceStatus,
    validationFlags,
    per100g: profile,
    per100gMeta: meta,
    measuredNutrientCount: Number(row.measured_nutrient_count ?? 0),
    missingFieldKeys,
  };
}

let nutritionViewHealthPromise: Promise<void> | null = null;

async function ensureNutritionViewsReady(): Promise<void> {
  if (!nutritionViewHealthPromise) {
    nutritionViewHealthPromise = (async () => {
      const pool = getDbPool();
      const result = await pool.query<{
        has_food_rows: boolean;
        has_recipe_rows: boolean;
        has_catalog_rows: boolean;
      }>(
        `
          SELECT
            EXISTS(SELECT 1 FROM core.app_food_profile_23 LIMIT 1) AS has_food_rows,
            EXISTS(SELECT 1 FROM core.app_recipe_profile_23 LIMIT 1) AS has_recipe_rows,
            EXISTS(SELECT 1 FROM core.app_catalog_profile_23 LIMIT 1) AS has_catalog_rows
        `
      );

      const row = result.rows[0];
      if (!row?.has_food_rows || !row.has_catalog_rows) {
        await recordRuntimeError({
          scope: 'nutrition_db.ensure_views_ready',
          code: 'materialized_views_empty',
          message: 'Nutrition materialized views are empty.',
          context: row ?? {},
        });
        throw new Error(
          '营养物化视图为空，请先执行 `bash ./db/refresh_materialized_views.sh`。'
        );
      }

      if (!row.has_recipe_rows) {
        await recordRuntimeError({
          scope: 'nutrition_db.ensure_views_ready',
          code: 'recipe_view_empty',
          message: 'core.app_recipe_profile_23 is empty; recipe lookup coverage will be reduced.',
        });
      }
    })().catch((error) => {
      nutritionViewHealthPromise = null;
      throw error;
    });
  }

  await nutritionViewHealthPromise;
}

async function queryMany<T extends CatalogRow>(
  sql: string,
  params: readonly unknown[]
): Promise<T[]> {
  const pool = getDbPool();
  const result = await pool.query<T>(sql, [...params]);
  return result.rows;
}

function stripIngredientDescriptor(foodName: string): string | null {
  const trimmed = sanitizeFoodName(foodName);
  if (!trimmed) {
    return null;
  }

  for (const suffix of ['馅', '末', '碎', '丁', '片', '丝', '块', '段']) {
    if (trimmed.endsWith(suffix) && trimmed.length - suffix.length >= 2) {
      return trimmed.slice(0, -suffix.length);
    }
  }

  return null;
}

export function buildLookupVariants(foodName: string): string[] {
  const queue = [sanitizeFoodName(foodName)];
  const variants = new Map<string, string>();

  while (queue.length) {
    const current = sanitizeFoodName(queue.shift() ?? '');
    if (!current) {
      continue;
    }

    const normalized = normalizeLookupText(current);
    if (!normalized || variants.has(normalized)) {
      continue;
    }

    variants.set(normalized, current);

    const stripped = stripIngredientDescriptor(current);
    if (stripped) {
      queue.push(stripped);
    }

    for (const group of LOOKUP_SYNONYM_GROUPS) {
      if ((group as readonly string[]).includes(current)) {
        queue.push(...group);
      }
    }
  }

  return [...variants.values()];
}

async function lookupExactCombined(
  foodName: string,
  normalizedName: string
): Promise<CatalogRow[]> {
  return queryMany<CatalogRow>(
    `
      SELECT *
      FROM (
        SELECT ${SELECT_COLUMNS},
               0 AS strategy_priority
        FROM core.recipe_alias ra
        JOIN core.app_catalog_profile_23 ac
          ON ac.entity_type = 'recipe'
         AND ac.entity_id = ra.recipe_id
        WHERE ra.language_code IN ('zh', 'en')
          AND (${CORE_MACRO_FILTER})
          AND (${EXACT_LOOKUP_READY_FILTER})
          AND (ra.alias_text = $1 OR ra.normalized_alias = $2)

        UNION ALL

        SELECT ${SELECT_COLUMNS},
               1 AS strategy_priority
        FROM core.canonical_food_alias cfa
        JOIN core.app_catalog_profile_23 ac
          ON ac.entity_type = 'food'
         AND ac.entity_id = cfa.canonical_food_id
        WHERE cfa.language_code IN ('zh', 'en')
          AND (${CORE_MACRO_FILTER})
          AND (${EXACT_LOOKUP_READY_FILTER})
          AND (cfa.alias_text = $1 OR cfa.normalized_alias = $2)

        UNION ALL

        SELECT ${SELECT_COLUMNS},
               2 AS strategy_priority
        FROM core.app_catalog_profile_23 ac
        WHERE (${CORE_MACRO_FILTER})
          AND (${EXACT_LOOKUP_READY_FILTER})
          AND ac.food_name_zh = $1
      ) exact_candidates
      ORDER BY
        strategy_priority ASC,
        publish_ready DESC,
        measured_nutrient_count DESC NULLS LAST,
        completeness_ratio DESC NULLS LAST
      LIMIT 8
    `,
    [foodName, normalizedName]
  );
}

async function lookupRecipeAliasFuzzy(normalizedName: string, threshold: number) {
  return queryMany<CatalogRow>(
    `
      SELECT ${SELECT_COLUMNS},
             similarity(ra.normalized_alias, $1) AS fuzzy_score,
             ra.alias_text AS lookup_alias_text
      FROM core.recipe_alias ra
      JOIN core.app_catalog_profile_23 ac
        ON ac.entity_type = 'recipe'
       AND ac.entity_id = ra.recipe_id
      WHERE ra.language_code IN ('zh', 'en')
        AND (${CORE_MACRO_FILTER})
        AND (${FUZZY_LOOKUP_READY_FILTER})
        AND ra.normalized_alias % $1
        AND similarity(ra.normalized_alias, $1) >= $2
      ORDER BY
        ac.publish_ready DESC,
        fuzzy_score DESC,
        ac.measured_nutrient_count DESC NULLS LAST,
        ac.completeness_ratio DESC NULLS LAST
      LIMIT 8
    `,
    [normalizedName, threshold]
  );
}

async function lookupCanonicalAliasFuzzy(normalizedName: string, threshold: number) {
  return queryMany<CatalogRow>(
    `
      SELECT ${SELECT_COLUMNS},
             similarity(cfa.normalized_alias, $1) AS fuzzy_score,
             cfa.alias_text AS lookup_alias_text
      FROM core.canonical_food_alias cfa
      JOIN core.app_catalog_profile_23 ac
        ON ac.entity_type = 'food'
       AND ac.entity_id = cfa.canonical_food_id
      WHERE cfa.language_code IN ('zh', 'en')
        AND (${CORE_MACRO_FILTER})
        AND (${FUZZY_LOOKUP_READY_FILTER})
        AND cfa.normalized_alias % $1
        AND similarity(cfa.normalized_alias, $1) >= $2
      ORDER BY
        ac.publish_ready DESC,
        fuzzy_score DESC,
        ac.measured_nutrient_count DESC NULLS LAST,
        ac.completeness_ratio DESC NULLS LAST
      LIMIT 8
    `,
    [normalizedName, threshold]
  );
}

async function lookupCatalogFuzzy(normalizedName: string, threshold: number) {
  return queryMany<CatalogRow>(
    `
      SELECT ${SELECT_COLUMNS},
             similarity(regexp_replace(lower(COALESCE(ac.food_name_zh, '')), '\s+', '', 'g'), $1) AS fuzzy_score
      FROM core.app_catalog_profile_23 ac
      WHERE (${CORE_MACRO_FILTER})
        AND (${FUZZY_LOOKUP_READY_FILTER})
        AND regexp_replace(lower(COALESCE(ac.food_name_zh, '')), '\s+', '', 'g') % $1
        AND similarity(regexp_replace(lower(COALESCE(ac.food_name_zh, '')), '\s+', '', 'g'), $1) >= $2
      ORDER BY
        CASE WHEN ac.entity_type = 'recipe' THEN 0 ELSE 1 END,
        ac.publish_ready DESC,
        fuzzy_score DESC,
        ac.measured_nutrient_count DESC NULLS LAST,
        ac.completeness_ratio DESC NULLS LAST
      LIMIT 8
    `,
    [normalizedName, threshold]
  );
}

async function lookupExactAcrossVariants(variants: string[]): Promise<CatalogRow[]> {
  const rows: CatalogRow[] = [];
  const seen = new Set<string>();

  for (const variant of variants) {
    const exactMatches = await lookupExactCombined(variant, normalizeLookupText(variant));
    for (const match of exactMatches) {
      const rowKey = [
        match.entity_id ?? '',
        match.source_item_id ?? '',
        match.food_name_zh ?? match.food_name_en ?? '',
      ].join(':');
      if (seen.has(rowKey)) {
        continue;
      }
      seen.add(rowKey);
      rows.push(match);
    }
  }

  return rows;
}

async function lookupFuzzyAcrossVariants(
  foodName: string,
  variants: string[]
): Promise<NutritionLookupResult | null> {
  for (const variant of variants) {
    const normalizedVariant = normalizeLookupText(variant);
    if (normalizedVariant.length < 2) {
      continue;
    }

    const recipeAliasThreshold = getFuzzyThreshold(normalizedVariant, 'alias');
    const canonicalAliasThreshold = getFuzzyThreshold(normalizedVariant, 'alias');
    const catalogThreshold = getFuzzyThreshold(normalizedVariant, 'catalog');

    const strategies = [
      recipeAliasThreshold === null
        ? null
        : {
            priority: 0,
            execute: () => lookupRecipeAliasFuzzy(normalizedVariant, recipeAliasThreshold),
          },
      canonicalAliasThreshold === null
        ? null
        : {
            priority: 1,
            execute: () => lookupCanonicalAliasFuzzy(normalizedVariant, canonicalAliasThreshold),
          },
      catalogThreshold === null
        ? null
        : {
            priority: 2,
            execute: () => lookupCatalogFuzzy(normalizedVariant, catalogThreshold),
          },
    ].filter(Boolean) as Array<{priority: number; execute: () => Promise<CatalogRow[]>}>;

    if (!strategies.length) {
      continue;
    }

    const fuzzyMatch = await runFuzzyStrategies(foodName, strategies);
    if (fuzzyMatch) {
      return fuzzyMatch;
    }
  }

  return null;
}

function getFuzzyThreshold(
  normalizedName: string,
  strategyKind: FuzzyStrategyKind
): number | null {
  const length = normalizedName.length;
  if (length < 2) {
    return null;
  }

  if (length === 2) {
    return strategyKind === 'alias' ? 0.65 : 0.75;
  }

  if (length <= 4) {
    return strategyKind === 'alias' ? 0.68 : 0.74;
  }

  return strategyKind === 'alias' ? 0.54 : 0.58;
}

function getTailToken(value: string): string | null {
  return ANATOMY_TAILS.find((token) => value.includes(token)) ?? null;
}

function getShortNameSemanticTail(value: string): string | null {
  return SHORT_NAME_SEMANTIC_TAILS.find((token) => value.endsWith(token)) ?? null;
}

function hasDangerousSemanticSuffix(
  normalizedFoodName: string,
  normalizedMatchedName: string
): boolean {
  if (DANGEROUS_SUFFIX_PATTERN.test(normalizedMatchedName)) {
    return true;
  }

  if (!normalizedFoodName.endsWith('粉') && normalizedMatchedName.endsWith('粉')) {
    return true;
  }

  if (!normalizedFoodName.endsWith('汁') && normalizedMatchedName.endsWith('汁')) {
    return true;
  }

  return false;
}

export function isSafeFuzzyCandidate(foodName: string, row: CatalogRow): boolean {
  const normalizedFoodName = normalizeLookupText(sanitizeFoodName(foodName));
  const normalizedMatchedName = normalizeLookupText(
    sanitizeFoodName(row.food_name_zh ?? row.lookup_alias_text ?? '')
  );

  if (!normalizedFoodName || !normalizedMatchedName) {
    return false;
  }

  if (normalizedFoodName.length < 2) {
    return false;
  }

  if (UNSAFE_FUZZY_MATCH_PATTERN.test(normalizedMatchedName)) {
    return false;
  }

  if (/[，,]/.test(normalizedMatchedName)) {
    return false;
  }

  if (hasDangerousSemanticSuffix(normalizedFoodName, normalizedMatchedName)) {
    return false;
  }

  const matchedTail = getTailToken(normalizedMatchedName);
  const targetTail = getTailToken(normalizedFoodName);
  if (matchedTail && targetTail && matchedTail !== targetTail) {
    return false;
  }

  const matchedSemanticTail = getShortNameSemanticTail(normalizedMatchedName);
  const targetSemanticTail = getShortNameSemanticTail(normalizedFoodName);
  if (
    normalizedFoodName.length <= 3 &&
    matchedSemanticTail &&
    targetSemanticTail &&
    matchedSemanticTail !== targetSemanticTail
  ) {
    return false;
  }

  if (normalizedFoodName.length <= 3) {
    const sameStart = normalizedMatchedName[0] === normalizedFoodName[0];
    const sameEnd =
      normalizedMatchedName[normalizedMatchedName.length - 1] ===
      normalizedFoodName[normalizedFoodName.length - 1];
    const lengthDiff = Math.abs(normalizedMatchedName.length - normalizedFoodName.length);
    return sameStart && sameEnd && lengthDiff <= 1 && (row.fuzzy_score ?? 0) >= 0.84;
  }

  if (normalizedMatchedName === normalizedFoodName) {
    return true;
  }

  if (normalizedMatchedName.startsWith(normalizedFoodName)) {
    const suffix = normalizedMatchedName.slice(normalizedFoodName.length);
    return Boolean(suffix) && !hasDangerousSemanticSuffix(normalizedFoodName, normalizedMatchedName);
  }

  if (normalizedFoodName.startsWith(normalizedMatchedName)) {
    return normalizedMatchedName.length > 4;
  }

  return (row.fuzzy_score ?? 0) >= getFuzzyThreshold(normalizedFoodName, 'alias')!;
}

async function runFuzzyStrategies(
  foodName: string,
  strategies: Array<{
    priority: number;
    execute: () => Promise<CatalogRow[]>;
  }>
): Promise<NutritionLookupResult | null> {
  const results = await Promise.all(
    strategies.map(async (strategy) => ({
      priority: strategy.priority,
      rows: await strategy.execute(),
    }))
  );

  const rankedRows = results
    .flatMap((result) =>
      result.rows.map((row) => ({
        row,
        priority: result.priority,
      }))
    )
    .filter((candidate) => isSafeFuzzyCandidate(foodName, candidate.row))
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }

      if (a.row.publish_ready !== b.row.publish_ready) {
        return a.row.publish_ready ? -1 : 1;
      }

      const scoreDelta = (b.row.fuzzy_score ?? 0) - (a.row.fuzzy_score ?? 0);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      const nutrientDelta =
        (Number(b.row.measured_nutrient_count) || 0) -
        (Number(a.row.measured_nutrient_count) || 0);
      if (nutrientDelta !== 0) {
        return nutrientDelta;
      }

      return (Number(b.row.completeness_ratio) || 0) - (Number(a.row.completeness_ratio) || 0);
    });

  return selectBestLookupCandidate(
    foodName,
    rankedRows.map((candidate) => candidate.row),
    'fuzzy'
  ).result;
}

async function lookupNutritionByNameInternal(
  foodName: string,
  {
    allowFuzzy = true,
    recordMiss = false,
  }: {
    allowFuzzy?: boolean;
    recordMiss?: boolean;
  } = {}
): Promise<NutritionLookupResult | null> {
  await ensureNutritionViewsReady();
  const trimmedFoodName = foodName.trim();
  const variants = buildLookupVariants(trimmedFoodName);
  const normalizedName = normalizeLookupText(variants[0] ?? trimmedFoodName);
  const version = await getRuntimeLookupVersion('lookup');
  const mode: LookupMode = allowFuzzy ? 'auto' : 'exact';

  const result = await withNutritionLookupCache(
    `${version}:${mode}:${variants.join('|')}:${normalizedName}`,
    async () => {
      const lookupVariants = variants.length ? variants : [trimmedFoodName];
      const exactMatches = await lookupExactAcrossVariants(lookupVariants);
      const exactCandidate = selectBestLookupCandidate(trimmedFoodName, exactMatches, 'exact');
      if (exactCandidate.result) {
        return exactCandidate.result;
      }

      const curatedOverride = getCuratedBrandOverrideDefinition(lookupVariants);
      if (curatedOverride) {
        return createCuratedBrandLookupResult(curatedOverride, exactCandidate.rejectionFlags);
      }

      if (!allowFuzzy || normalizedName.length < 2) {
        return null;
      }

      return lookupFuzzyAcrossVariants(
        trimmedFoodName,
        lookupVariants
      );
    }
  );

  if (!result && recordMiss) {
    await recordLookupMiss(trimmedFoodName);
  }

  return result;
}

export async function lookupNutritionByNameExact(
  foodName: string
): Promise<NutritionLookupResult | null> {
  return lookupNutritionByNameInternal(foodName, {allowFuzzy: false});
}

export async function lookupNutritionByNameFuzzy(
  foodName: string
): Promise<NutritionLookupResult | null> {
  return lookupNutritionByNameInternal(foodName, {allowFuzzy: true});
}

export async function lookupNutritionByName(
  foodName: string
): Promise<NutritionLookupResult | null> {
  return lookupNutritionByNameInternal(foodName, {
    allowFuzzy: true,
    recordMiss: true,
  });
}

export function createNutritionLookupResolver(): NutritionLookupResolver {
  const memo = new Map<string, Promise<NutritionLookupResult | null>>();

  return (foodName, options = {}) => {
    const trimmed = foodName.trim();
    const variants = buildLookupVariants(trimmed);
    const normalized = normalizeLookupText(variants[0] ?? trimmed);
    const allowFuzzy = options.allowFuzzy ?? true;
    const recordMiss = options.recordMiss ?? false;
    const key = `${allowFuzzy ? 'auto' : 'exact'}:${variants.join('|')}:${normalized}`;

    if (!memo.has(key)) {
      memo.set(
        key,
        lookupNutritionByNameInternal(trimmed, {
          allowFuzzy,
          recordMiss: false,
        })
      );
    }

    const resultPromise = memo.get(key)!;
    if (!recordMiss) {
      return resultPromise;
    }

    return resultPromise.then(async (result) => {
      if (!result) {
        await recordLookupMiss(trimmed);
      }
      return result;
    });
  };
}
