import {getDbPool} from '@/lib/db';
import type {MatchMode, SourceStatus, ValidationFlag} from '@/lib/food-contract';
import {
  DANGEROUS_SUFFIX_PATTERN,
  UNSAFE_FUZZY_MATCH_PATTERN,
  normalizeLookupText,
  sanitizeFoodName,
} from '@/lib/food-text';
import {recordLookupMiss} from '@/lib/miss-telemetry';
import {getRuntimeLookupVersion} from '@/lib/runtime-cache-version';
import {
  NON_CORE_NUTRITION_KEYS,
  createNutritionProfile,
  createNutritionProfileMeta,
  normalizeNutritionValue,
  type NutritionFieldKey,
  type NutritionProfile23,
  type NutritionProfileMeta23,
} from '@/lib/nutrition-profile';

type SourceKind = 'recipe' | 'catalog';
type FuzzyStrategyKind = 'alias' | 'catalog';
type LookupMode = 'exact' | 'auto';

declare global {
  // eslint-disable-next-line no-var
  var __fitnessFoodNutritionLookupCache:
    | Map<string, {expiresAt: number; value: Promise<NutritionLookupResult | null>}>
    | undefined;
}

const NUTRITION_LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;
const NUTRITION_LOOKUP_CACHE_MAX_SIZE = 1024;

const SELECT_COLUMNS = `
  ac.entity_type,
  ac.food_name_zh,
  ac.food_name_en,
  ac.source_system,
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
      COALESCE(ac.completeness_ratio, 0) >= 0.6
      AND COALESCE(ac.macro_present_count, 0) = 4
      AND COALESCE(ac.measured_nutrient_count, 0) >= 12
    )
  )
`;

const FUZZY_LOOKUP_READY_FILTER = `
  (
    ac.publish_ready = TRUE
    OR (
      COALESCE(ac.completeness_ratio, 0) >= 0.82
      AND COALESCE(ac.macro_present_count, 0) = 4
      AND COALESCE(ac.measured_nutrient_count, 0) >= 18
    )
  )
`;

const ANATOMY_TAILS = [
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
  food_name_zh: string | null;
  food_name_en: string | null;
  source_system: string;
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
        throw new Error(
          '营养物化视图为空，请先执行 `bash ./db/refresh_materialized_views.sh`。'
        );
      }

      if (!row.has_recipe_rows) {
        console.warn('core.app_recipe_profile_23 is empty; recipe lookup coverage will be reduced.');
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

async function queryFirst(
  sql: string,
  params: readonly unknown[]
): Promise<CatalogRow | null> {
  const rows = await queryMany<CatalogRow>(sql, params);
  return rows[0] ?? null;
}

async function lookupExactCombined(
  foodName: string,
  normalizedName: string
): Promise<CatalogRow | null> {
  return queryFirst(
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
      LIMIT 1
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

function getFuzzyThreshold(
  normalizedName: string,
  strategyKind: FuzzyStrategyKind
): number | null {
  const length = normalizedName.length;
  if (length < 2) {
    return null;
  }

  if (length === 2) {
    return strategyKind === 'alias' ? 0.82 : 0.92;
  }

  if (length <= 4) {
    return strategyKind === 'alias' ? 0.68 : 0.74;
  }

  return strategyKind === 'alias' ? 0.54 : 0.58;
}

function getTailToken(value: string): string | null {
  return ANATOMY_TAILS.find((token) => value.includes(token)) ?? null;
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

  if (normalizedFoodName.length === 2) {
    const sameStart = normalizedMatchedName[0] === normalizedFoodName[0];
    const sameEnd =
      normalizedMatchedName[normalizedMatchedName.length - 1] ===
      normalizedFoodName[normalizedFoodName.length - 1];
    const lengthDiff = Math.abs(normalizedMatchedName.length - normalizedFoodName.length);
    return sameStart && sameEnd && lengthDiff <= 1 && (row.fuzzy_score ?? 0) >= 0.82;
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

  const bestRow = rankedRows[0]?.row;
  return bestRow ? mapRowToLookupResult(bestRow, 'fuzzy') : null;
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
  const normalizedName = normalizeLookupText(trimmedFoodName);
  const version = await getRuntimeLookupVersion('lookup');
  const mode: LookupMode = allowFuzzy ? 'auto' : 'exact';

  const result = await withNutritionLookupCache(
    `${version}:${mode}:${trimmedFoodName}:${normalizedName}`,
    async () => {
      const exactMatch = await lookupExactCombined(trimmedFoodName, normalizedName);
      if (exactMatch) {
        return mapRowToLookupResult(exactMatch, 'exact');
      }

      if (!allowFuzzy || normalizedName.length <= 2) {
        return null;
      }

      const recipeAliasThreshold = getFuzzyThreshold(normalizedName, 'alias');
      const canonicalAliasThreshold = getFuzzyThreshold(normalizedName, 'alias');
      const catalogThreshold = getFuzzyThreshold(normalizedName, 'catalog');

      const strategies = [
        recipeAliasThreshold === null
          ? null
          : {
              priority: 0,
              execute: () => lookupRecipeAliasFuzzy(normalizedName, recipeAliasThreshold),
            },
        canonicalAliasThreshold === null
          ? null
          : {
              priority: 1,
              execute: () => lookupCanonicalAliasFuzzy(normalizedName, canonicalAliasThreshold),
            },
        catalogThreshold === null
          ? null
          : {
              priority: 2,
              execute: () => lookupCatalogFuzzy(normalizedName, catalogThreshold),
            },
      ].filter(Boolean) as Array<{priority: number; execute: () => Promise<CatalogRow[]>}>;

      if (!strategies.length) {
        return null;
      }

      return runFuzzyStrategies(trimmedFoodName, strategies);
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
    const normalized = normalizeLookupText(trimmed);
    const allowFuzzy = options.allowFuzzy ?? true;
    const recordMiss = options.recordMiss ?? false;
    const key = `${allowFuzzy ? 'auto' : 'exact'}:${trimmed}:${normalized}`;

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
