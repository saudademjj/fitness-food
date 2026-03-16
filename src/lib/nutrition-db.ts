import {getDbPool} from '@/lib/db';
import type {MatchMode, SourceStatus, ValidationFlag} from '@/lib/food-contract';
import {
  DANGEROUS_SUFFIX_PATTERN,
  UNSAFE_FUZZY_MATCH_PATTERN,
  normalizeLookupText,
  sanitizeFoodName,
} from '@/lib/food-text';
import {recordLookupMiss} from '@/lib/miss-telemetry';
import {
  createNutritionProfile,
  normalizeNutritionValue,
  type NutritionProfile23,
} from '@/lib/nutrition-profile';

type SourceKind = 'recipe' | 'catalog';
type FuzzyStrategyKind = 'alias' | 'catalog';

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
  ac.amount_basis_g,
  ac.publish_ready,
  ac.completeness_ratio
`;

const CORE_MACRO_FILTER = `
  ac.energy_kcal IS NOT NULL
  AND ac.protein_grams IS NOT NULL
  AND ac.carbohydrate_grams IS NOT NULL
  AND ac.fat_grams IS NOT NULL
`;

const LOOKUP_READY_FILTER = `
  (ac.publish_ready = TRUE OR COALESCE(ac.completeness_ratio, 0) >= 0.6)
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
  amount_basis_g: number | null;
  publish_ready: boolean;
  completeness_ratio: number | null;
  fuzzy_score?: number | null;
  lookup_alias_text?: string | null;
};

export type NutritionLookupResult = {
  sourceKind: SourceKind;
  sourceLabel: string;
  matchedName: string;
  per100g: NutritionProfile23;
  amountBasisG: number;
  matchMode: MatchMode;
  sourceStatus: SourceStatus;
  validationFlags: ValidationFlag[];
};

function buildPer100gProfile(row: CatalogRow, amountBasisG: number): NutritionProfile23 {
  return createNutritionProfile({
    energyKcal: normalizeNutritionValue(row.energy_kcal, amountBasisG),
    proteinGrams: normalizeNutritionValue(row.protein_grams, amountBasisG),
    carbohydrateGrams: normalizeNutritionValue(row.carbohydrate_grams, amountBasisG),
    fatGrams: normalizeNutritionValue(row.fat_grams, amountBasisG),
    fiberGrams: normalizeNutritionValue(row.fiber_grams, amountBasisG),
    sugarsGrams: normalizeNutritionValue(row.sugars_grams, amountBasisG),
    sodiumMg: normalizeNutritionValue(row.sodium_mg, amountBasisG),
    potassiumMg: normalizeNutritionValue(row.potassium_mg, amountBasisG),
    calciumMg: normalizeNutritionValue(row.calcium_mg, amountBasisG),
    magnesiumMg: normalizeNutritionValue(row.magnesium_mg, amountBasisG),
    ironMg: normalizeNutritionValue(row.iron_mg, amountBasisG),
    zincMg: normalizeNutritionValue(row.zinc_mg, amountBasisG),
    vitaminAMcg: normalizeNutritionValue(row.vitamin_a_mcg, amountBasisG),
    vitaminCMg: normalizeNutritionValue(row.vitamin_c_mg, amountBasisG),
    vitaminDMcg: normalizeNutritionValue(row.vitamin_d_mcg, amountBasisG),
    vitaminEMg: normalizeNutritionValue(row.vitamin_e_mg, amountBasisG),
    vitaminKMcg: normalizeNutritionValue(row.vitamin_k_mcg, amountBasisG),
    thiaminMg: normalizeNutritionValue(row.thiamin_mg, amountBasisG),
    riboflavinMg: normalizeNutritionValue(row.riboflavin_mg, amountBasisG),
    niacinMg: normalizeNutritionValue(row.niacin_mg, amountBasisG),
    vitaminB6Mg: normalizeNutritionValue(row.vitamin_b6_mg, amountBasisG),
    vitaminB12Mcg: normalizeNutritionValue(row.vitamin_b12_mcg, amountBasisG),
    folateMcg: normalizeNutritionValue(row.folate_mcg, amountBasisG),
  });
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
    validationFlags: [],
    per100g: buildPer100gProfile(row, amountBasisG),
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

async function lookupRecipeAliasExact(foodName: string, normalizedName: string) {
  return queryFirst(
    `
      SELECT ${SELECT_COLUMNS}
      FROM core.recipe_alias ra
      JOIN core.app_catalog_profile_23 ac
        ON ac.entity_type = 'recipe'
       AND ac.entity_id = ra.recipe_id
      WHERE ra.language_code IN ('zh', 'en')
        AND (${CORE_MACRO_FILTER})
        AND (${LOOKUP_READY_FILTER})
        AND (ra.alias_text = $1 OR ra.normalized_alias = $2)
      ORDER BY ac.publish_ready DESC, ac.completeness_ratio DESC NULLS LAST
      LIMIT 1
    `,
    [foodName, normalizedName]
  );
}

async function lookupCanonicalAliasExact(foodName: string, normalizedName: string) {
  return queryFirst(
    `
      SELECT ${SELECT_COLUMNS}
      FROM core.canonical_food_alias cfa
      JOIN core.app_catalog_profile_23 ac
        ON ac.entity_type = 'food'
       AND ac.entity_id = cfa.canonical_food_id
      WHERE cfa.language_code IN ('zh', 'en')
        AND (${CORE_MACRO_FILTER})
        AND (${LOOKUP_READY_FILTER})
        AND (cfa.alias_text = $1 OR cfa.normalized_alias = $2)
      ORDER BY ac.publish_ready DESC, ac.completeness_ratio DESC NULLS LAST
      LIMIT 1
    `,
    [foodName, normalizedName]
  );
}

async function lookupCatalogExact(foodName: string) {
  return queryFirst(
    `
      SELECT ${SELECT_COLUMNS}
      FROM core.app_catalog_profile_23 ac
      WHERE (${CORE_MACRO_FILTER})
        AND (${LOOKUP_READY_FILTER})
        AND ac.food_name_zh = $1
      ORDER BY
        CASE WHEN ac.entity_type = 'recipe' THEN 0 ELSE 1 END,
        ac.publish_ready DESC,
        ac.completeness_ratio DESC NULLS LAST
      LIMIT 1
    `,
    [foodName]
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
        AND (${LOOKUP_READY_FILTER})
        AND similarity(ra.normalized_alias, $1) >= $2
      ORDER BY ac.publish_ready DESC, fuzzy_score DESC, ac.completeness_ratio DESC NULLS LAST
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
        AND (${LOOKUP_READY_FILTER})
        AND similarity(cfa.normalized_alias, $1) >= $2
      ORDER BY ac.publish_ready DESC, fuzzy_score DESC, ac.completeness_ratio DESC NULLS LAST
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
        AND (${LOOKUP_READY_FILTER})
        AND similarity(regexp_replace(lower(COALESCE(ac.food_name_zh, '')), '\s+', '', 'g'), $1) >= $2
      ORDER BY
        CASE WHEN ac.entity_type = 'recipe' THEN 0 ELSE 1 END,
        ac.publish_ready DESC,
        fuzzy_score DESC,
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
    return Boolean(suffix) && !DANGEROUS_SUFFIX_PATTERN.test(suffix);
  }

  if (normalizedFoodName.startsWith(normalizedMatchedName)) {
    return normalizedMatchedName.length > 4;
  }

  return (row.fuzzy_score ?? 0) >= getFuzzyThreshold(normalizedFoodName, 'alias')!;
}

async function runLookupStrategies(
  strategies: Array<() => Promise<CatalogRow | null>>
): Promise<NutritionLookupResult | null> {
  const rows = await Promise.all(strategies.map((strategy) => strategy()));
  const matched = rows.find((row) => row !== null);
  return matched ? mapRowToLookupResult(matched, 'exact') : null;
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

      return (Number(b.row.completeness_ratio) || 0) - (Number(a.row.completeness_ratio) || 0);
    });

  const bestRow = rankedRows[0]?.row;
  return bestRow ? mapRowToLookupResult(bestRow, 'fuzzy') : null;
}

export async function lookupNutritionByNameExact(
  foodName: string
): Promise<NutritionLookupResult | null> {
  await ensureNutritionViewsReady();
  const normalizedName = normalizeLookupText(foodName);
  return runLookupStrategies([
    () => lookupRecipeAliasExact(foodName, normalizedName),
    () => lookupCanonicalAliasExact(foodName, normalizedName),
    () => lookupCatalogExact(foodName),
  ]);
}

export async function lookupNutritionByNameFuzzy(
  foodName: string
): Promise<NutritionLookupResult | null> {
  await ensureNutritionViewsReady();
  const normalizedName = normalizeLookupText(foodName);
  if (normalizedName.length < 2) {
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

  return runFuzzyStrategies(foodName, strategies);
}

export async function lookupNutritionByName(
  foodName: string
): Promise<NutritionLookupResult | null> {
  const result =
    (await lookupNutritionByNameExact(foodName)) ??
    (await lookupNutritionByNameFuzzy(foodName));

  if (!result) {
    await recordLookupMiss(foodName);
  }

  return result;
}
