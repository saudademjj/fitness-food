import {config as loadEnv} from 'dotenv';

import {getDbPool} from '../src/lib/db';

loadEnv({path: '.env.local'});
loadEnv();

type NamedCountRow = {
  name: string;
  row_count: number;
};

type SummaryRow = {
  portion_reference_rows: number;
  portion_reference_foods: number;
  app_catalog_publish_ready: number;
  app_catalog_total: number;
  app_catalog_macro_complete: number;
  app_catalog_preview_macro_complete: number;
  app_catalog_exact_lookup_ready: number;
  app_catalog_fuzzy_lookup_ready: number;
  app_recipe_publish_ready: number;
  app_recipe_total: number;
  app_recipe_macro_complete: number;
  app_recipe_exact_lookup_ready: number;
  app_recipe_fuzzy_lookup_ready: number;
  nutrition_refresh_pending: boolean | null;
};

type ParseTelemetryRow = {
  parse_events_24h: number;
  avg_confidence_24h: number | null;
  ai_fallback_items_24h: number | null;
  total_items_24h: number | null;
  runtime_composite_items_24h: number | null;
};

async function queryNamedCounts(
  sql: string
): Promise<Array<{name: string; rowCount: number}>> {
  const pool = getDbPool();
  const result = await pool.query<NamedCountRow>(sql);
  return result.rows.map((row) => ({
    name: row.name,
    rowCount: Number(row.row_count ?? 0),
  }));
}

async function main(): Promise<void> {
  const pool = getDbPool();

  const summaryResult = await pool.query<SummaryRow>(`
    SELECT
      (SELECT COUNT(*)::int FROM core.portion_reference) AS portion_reference_rows,
      (
        SELECT COUNT(DISTINCT COALESCE(NULLIF(normalized_name_zh, ''), food_name_zh))::int
        FROM core.portion_reference
      ) AS portion_reference_foods,
      (
        SELECT COUNT(*)::int
        FROM core.app_catalog_profile_23
        WHERE publish_ready
      ) AS app_catalog_publish_ready,
      (SELECT COUNT(*)::int FROM core.app_catalog_profile_23) AS app_catalog_total,
      (
        SELECT COUNT(*)::int
        FROM core.app_catalog_profile_23
        WHERE COALESCE(energy_kcal_is_present, FALSE)
          AND COALESCE(protein_grams_is_present, FALSE)
          AND COALESCE(carbohydrate_grams_is_present, FALSE)
          AND COALESCE(fat_grams_is_present, FALSE)
      ) AS app_catalog_macro_complete,
      (
        SELECT COUNT(*)::int
        FROM core.app_catalog_profile_23
        WHERE NOT publish_ready
          AND COALESCE(energy_kcal_is_present, FALSE)
          AND COALESCE(protein_grams_is_present, FALSE)
          AND COALESCE(carbohydrate_grams_is_present, FALSE)
          AND COALESCE(fat_grams_is_present, FALSE)
      ) AS app_catalog_preview_macro_complete,
      (
        SELECT COUNT(*)::int
        FROM core.app_catalog_profile_23
        WHERE COALESCE(energy_kcal_is_present, FALSE)
          AND COALESCE(protein_grams_is_present, FALSE)
          AND COALESCE(carbohydrate_grams_is_present, FALSE)
          AND COALESCE(fat_grams_is_present, FALSE)
          AND (
            publish_ready
            OR (
              COALESCE(macro_present_count, 0) = 4
              AND COALESCE(measured_nutrient_count, 0) >= 4
            )
          )
      ) AS app_catalog_exact_lookup_ready,
      (
        SELECT COUNT(*)::int
        FROM core.app_catalog_profile_23
        WHERE COALESCE(energy_kcal_is_present, FALSE)
          AND COALESCE(protein_grams_is_present, FALSE)
          AND COALESCE(carbohydrate_grams_is_present, FALSE)
          AND COALESCE(fat_grams_is_present, FALSE)
          AND (
            publish_ready
            OR (
              COALESCE(completeness_ratio, 0) >= 0.4
              AND COALESCE(macro_present_count, 0) = 4
              AND COALESCE(measured_nutrient_count, 0) >= 6
            )
          )
      ) AS app_catalog_fuzzy_lookup_ready,
      (
        SELECT COUNT(*)::int
        FROM core.app_recipe_profile_23
        WHERE publish_ready
      ) AS app_recipe_publish_ready,
      (SELECT COUNT(*)::int FROM core.app_recipe_profile_23) AS app_recipe_total,
      (
        SELECT COUNT(*)::int
        FROM core.app_recipe_profile_23
        WHERE COALESCE(energy_kcal_is_present, FALSE)
          AND COALESCE(protein_grams_is_present, FALSE)
          AND COALESCE(carbohydrate_grams_is_present, FALSE)
          AND COALESCE(fat_grams_is_present, FALSE)
      ) AS app_recipe_macro_complete,
      (
        SELECT COUNT(*)::int
        FROM core.app_recipe_profile_23
        WHERE COALESCE(energy_kcal_is_present, FALSE)
          AND COALESCE(protein_grams_is_present, FALSE)
          AND COALESCE(carbohydrate_grams_is_present, FALSE)
          AND COALESCE(fat_grams_is_present, FALSE)
          AND (
            publish_ready
            OR (
              COALESCE(macro_present_count, 0) = 4
              AND COALESCE(measured_nutrient_count, 0) >= 4
            )
          )
      ) AS app_recipe_exact_lookup_ready,
      (
        SELECT COUNT(*)::int
        FROM core.app_recipe_profile_23
        WHERE COALESCE(energy_kcal_is_present, FALSE)
          AND COALESCE(protein_grams_is_present, FALSE)
          AND COALESCE(carbohydrate_grams_is_present, FALSE)
          AND COALESCE(fat_grams_is_present, FALSE)
          AND (
            publish_ready
            OR (
              COALESCE(completeness_ratio, 0) >= 0.4
              AND COALESCE(macro_present_count, 0) = 4
              AND COALESCE(measured_nutrient_count, 0) >= 6
            )
          )
      ) AS app_recipe_fuzzy_lookup_ready
      ,
      (
        SELECT refresh_pending
        FROM app.materialized_view_refresh_state
        WHERE scope = 'nutrition_runtime'
        LIMIT 1
      ) AS nutrition_refresh_pending
  `);

  const summary = summaryResult.rows[0];
  if (!summary) {
    throw new Error('Failed to query runtime DB health summary.');
  }

  const portionSources = await queryNamedCounts(`
    SELECT reference_source AS name, COUNT(*)::int AS row_count
    FROM core.portion_reference
    GROUP BY reference_source
    ORDER BY COUNT(*) DESC, reference_source ASC
  `);

  const lookupMisses = await queryNamedCounts(`
    SELECT
      CASE
        WHEN lookup_surface IS NULL OR lookup_surface = '' THEN '(unknown)'
        ELSE lookup_surface
      END AS name,
      COUNT(*)::int AS row_count
    FROM app.lookup_miss_telemetry
    WHERE created_at >= NOW() - INTERVAL '7 days'
    GROUP BY 1
    ORDER BY COUNT(*) DESC, 1 ASC
    LIMIT 10
  `).catch(() => []);

  const parseTelemetryResult = await pool
    .query<ParseTelemetryRow>(`
      SELECT
        COUNT(*)::int AS parse_events_24h,
        AVG(overall_confidence)::numeric AS avg_confidence_24h,
        COALESCE(SUM(ai_fallback_item_count), 0)::int AS ai_fallback_items_24h,
        COALESCE(SUM(item_count), 0)::int AS total_items_24h,
        COALESCE(SUM(runtime_composite_item_count), 0)::int AS runtime_composite_items_24h
      FROM app.food_parse_telemetry
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    `)
    .catch(() => ({rows: [] as ParseTelemetryRow[]}));

  const parseTelemetry = parseTelemetryResult.rows[0] ?? null;

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      portionReferenceRows: Number(summary.portion_reference_rows ?? 0),
      portionReferenceDistinctFoods: Number(summary.portion_reference_foods ?? 0),
      appCatalogPublishReady: Number(summary.app_catalog_publish_ready ?? 0),
      appCatalogTotal: Number(summary.app_catalog_total ?? 0),
      appCatalogMacroComplete: Number(summary.app_catalog_macro_complete ?? 0),
      appCatalogPreviewMacroComplete: Number(summary.app_catalog_preview_macro_complete ?? 0),
      appCatalogExactLookupReady: Number(summary.app_catalog_exact_lookup_ready ?? 0),
      appCatalogFuzzyLookupReady: Number(summary.app_catalog_fuzzy_lookup_ready ?? 0),
      appRecipePublishReady: Number(summary.app_recipe_publish_ready ?? 0),
      appRecipeTotal: Number(summary.app_recipe_total ?? 0),
      appRecipeMacroComplete: Number(summary.app_recipe_macro_complete ?? 0),
      appRecipeExactLookupReady: Number(summary.app_recipe_exact_lookup_ready ?? 0),
      appRecipeFuzzyLookupReady: Number(summary.app_recipe_fuzzy_lookup_ready ?? 0),
      nutritionRefreshPending: Boolean(summary.nutrition_refresh_pending ?? false),
    },
    parseTelemetry24h: parseTelemetry
      ? {
          parseEvents: Number(parseTelemetry.parse_events_24h ?? 0),
          averageConfidence:
            parseTelemetry.avg_confidence_24h === null
              ? null
              : Number(parseTelemetry.avg_confidence_24h),
          aiFallbackRate:
            Number(parseTelemetry.total_items_24h ?? 0) > 0
              ? Number(
                  (
                    Number(parseTelemetry.ai_fallback_items_24h ?? 0) /
                    Number(parseTelemetry.total_items_24h ?? 1)
                  ).toFixed(4)
                )
              : null,
          runtimeCompositeItems: Number(parseTelemetry.runtime_composite_items_24h ?? 0),
        }
      : null,
    portionSources,
    recentLookupMisses: lookupMisses,
  };

  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch(async (error) => {
  console.error(
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  try {
    await getDbPool().end();
  } catch {
    // Ignore secondary shutdown errors when the primary query has already failed.
  }
  process.exitCode = 1;
});
