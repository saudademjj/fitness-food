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
  app_recipe_publish_ready: number;
  app_recipe_total: number;
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
        FROM core.app_recipe_profile_23
        WHERE publish_ready
      ) AS app_recipe_publish_ready,
      (SELECT COUNT(*)::int FROM core.app_recipe_profile_23) AS app_recipe_total
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

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      portionReferenceRows: Number(summary.portion_reference_rows ?? 0),
      portionReferenceDistinctFoods: Number(summary.portion_reference_foods ?? 0),
      appCatalogPublishReady: Number(summary.app_catalog_publish_ready ?? 0),
      appCatalogTotal: Number(summary.app_catalog_total ?? 0),
      appRecipePublishReady: Number(summary.app_recipe_publish_ready ?? 0),
      appRecipeTotal: Number(summary.app_recipe_total ?? 0),
    },
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
