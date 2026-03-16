import {getDbPool} from '@/lib/db';
import type {MacroNutrients} from '@/lib/macros';

type SourceKind = 'recipe' | 'catalog';

type CatalogRow = {
  entity_type: 'food' | 'recipe';
  food_name_zh: string | null;
  food_name_en: string | null;
  source_system: string;
  energy_kcal: number | null;
  protein_grams: number | null;
  carbohydrate_grams: number | null;
  fat_grams: number | null;
  amount_basis_g: number | null;
  publish_ready: boolean;
  completeness_ratio: number | null;
};

export type NutritionLookupResult = {
  sourceKind: SourceKind;
  sourceLabel: string;
  matchedName: string;
  per100g: MacroNutrients;
};

const CORE_MACRO_FILTER = `
  ac.energy_kcal IS NOT NULL
  AND ac.protein_grams IS NOT NULL
  AND ac.carbohydrate_grams IS NOT NULL
  AND ac.fat_grams IS NOT NULL
`;

const SELECT_COLUMNS = `
  ac.entity_type,
  ac.food_name_zh,
  ac.food_name_en,
  ac.source_system,
  ac.energy_kcal,
  ac.protein_grams,
  ac.carbohydrate_grams,
  ac.fat_grams,
  ac.amount_basis_g,
  ac.publish_ready,
  ac.completeness_ratio
`;

function normalizeLookupText(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');
}

function mapRowToLookupResult(row: CatalogRow): NutritionLookupResult {
  const matchedName = row.food_name_zh ?? row.food_name_en ?? '未知食物';
  const sourceKind: SourceKind = row.entity_type === 'recipe' ? 'recipe' : 'catalog';

  return {
    sourceKind,
    sourceLabel: sourceKind === 'recipe' ? `标准食谱 · ${matchedName}` : `营养库 · ${matchedName}`,
    matchedName,
    per100g: {
      energyKcal: row.energy_kcal ?? 0,
      proteinGrams: row.protein_grams ?? 0,
      carbohydrateGrams: row.carbohydrate_grams ?? 0,
      fatGrams: row.fat_grams ?? 0,
    },
  };
}

async function queryFirst(
  sql: string,
  params: readonly unknown[]
): Promise<CatalogRow | null> {
  const pool = getDbPool();
  const result = await pool.query<CatalogRow>(sql, [...params]);
  return result.rows[0] ?? null;
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

async function lookupRecipeAliasFuzzy(foodName: string, normalizedName: string) {
  return queryFirst(
    `
      SELECT ${SELECT_COLUMNS}
      FROM core.recipe_alias ra
      JOIN core.app_catalog_profile_23 ac
        ON ac.entity_type = 'recipe'
       AND ac.entity_id = ra.recipe_id
      WHERE ra.language_code IN ('zh', 'en')
        AND (${CORE_MACRO_FILTER})
        AND (
          ra.alias_text ILIKE '%' || $1 || '%'
          OR $1 ILIKE '%' || ra.alias_text || '%'
          OR ra.normalized_alias LIKE '%' || $2 || '%'
          OR $2 LIKE '%' || ra.normalized_alias || '%'
        )
      ORDER BY
        ac.publish_ready DESC,
        ABS(char_length(ra.alias_text) - char_length($1)),
        ac.completeness_ratio DESC NULLS LAST
      LIMIT 1
    `,
    [foodName, normalizedName]
  );
}

async function lookupCanonicalAliasFuzzy(foodName: string, normalizedName: string) {
  return queryFirst(
    `
      SELECT ${SELECT_COLUMNS}
      FROM core.canonical_food_alias cfa
      JOIN core.app_catalog_profile_23 ac
        ON ac.entity_type = 'food'
       AND ac.entity_id = cfa.canonical_food_id
      WHERE cfa.language_code IN ('zh', 'en')
        AND (${CORE_MACRO_FILTER})
        AND (
          cfa.alias_text ILIKE '%' || $1 || '%'
          OR $1 ILIKE '%' || cfa.alias_text || '%'
          OR cfa.normalized_alias LIKE '%' || $2 || '%'
          OR $2 LIKE '%' || cfa.normalized_alias || '%'
        )
      ORDER BY
        ac.publish_ready DESC,
        ABS(char_length(cfa.alias_text) - char_length($1)),
        ac.completeness_ratio DESC NULLS LAST
      LIMIT 1
    `,
    [foodName, normalizedName]
  );
}

async function lookupCatalogFuzzy(foodName: string) {
  return queryFirst(
    `
      SELECT ${SELECT_COLUMNS}
      FROM core.app_catalog_profile_23 ac
      WHERE (${CORE_MACRO_FILTER})
        AND (
          ac.food_name_zh ILIKE '%' || $1 || '%'
          OR $1 ILIKE '%' || ac.food_name_zh || '%'
        )
      ORDER BY
        CASE WHEN ac.entity_type = 'recipe' THEN 0 ELSE 1 END,
        ac.publish_ready DESC,
        ABS(char_length(ac.food_name_zh) - char_length($1)),
        ac.completeness_ratio DESC NULLS LAST
      LIMIT 1
    `,
    [foodName]
  );
}

async function runLookupStrategies(
  strategies: Array<() => Promise<CatalogRow | null>>
): Promise<NutritionLookupResult | null> {
  for (const strategy of strategies) {
    const row = await strategy();
    if (row) {
      return mapRowToLookupResult(row);
    }
  }

  return null;
}

export async function lookupNutritionByNameExact(
  foodName: string
): Promise<NutritionLookupResult | null> {
  const normalizedName = normalizeLookupText(foodName);
  const strategies = [
    () => lookupRecipeAliasExact(foodName, normalizedName),
    () => lookupCanonicalAliasExact(foodName, normalizedName),
    () => lookupCatalogExact(foodName),
  ];

  return runLookupStrategies(strategies);
}

export async function lookupNutritionByNameFuzzy(
  foodName: string
): Promise<NutritionLookupResult | null> {
  const normalizedName = normalizeLookupText(foodName);
  const strategies = [
    () => lookupRecipeAliasFuzzy(foodName, normalizedName),
    () => lookupCanonicalAliasFuzzy(foodName, normalizedName),
    () => lookupCatalogFuzzy(foodName),
  ];

  return runLookupStrategies(strategies);
}

export async function lookupNutritionByName(foodName: string): Promise<NutritionLookupResult | null> {
  return (
    (await lookupNutritionByNameExact(foodName)) ??
    (await lookupNutritionByNameFuzzy(foodName))
  );
}
