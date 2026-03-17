CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.runtime_cache_state (
  scope TEXT PRIMARY KEY,
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app.runtime_cache_state (scope, version)
VALUES ('lookup', 1)
ON CONFLICT (scope) DO NOTHING;

CREATE OR REPLACE FUNCTION app.bump_runtime_cache_state(state_scope TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO app.runtime_cache_state (scope, version, updated_at)
  VALUES (state_scope, 1, NOW())
  ON CONFLICT (scope) DO UPDATE
  SET
    version = app.runtime_cache_state.version + 1,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION app.bump_lookup_runtime_cache_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM app.bump_runtime_cache_state('lookup');
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_portion_reference_bump_runtime_cache_state ON core.portion_reference;
CREATE TRIGGER trg_portion_reference_bump_runtime_cache_state
AFTER INSERT OR UPDATE OR DELETE ON core.portion_reference
FOR EACH STATEMENT
EXECUTE FUNCTION app.bump_lookup_runtime_cache_state();

DROP TRIGGER IF EXISTS trg_canonical_food_alias_bump_runtime_cache_state ON core.canonical_food_alias;
CREATE TRIGGER trg_canonical_food_alias_bump_runtime_cache_state
AFTER INSERT OR UPDATE OR DELETE ON core.canonical_food_alias
FOR EACH STATEMENT
EXECUTE FUNCTION app.bump_lookup_runtime_cache_state();

DROP TRIGGER IF EXISTS trg_recipe_alias_bump_runtime_cache_state ON core.recipe_alias;
CREATE TRIGGER trg_recipe_alias_bump_runtime_cache_state
AFTER INSERT OR UPDATE OR DELETE ON core.recipe_alias
FOR EACH STATEMENT
EXECUTE FUNCTION app.bump_lookup_runtime_cache_state();

CREATE TABLE IF NOT EXISTS app.ai_usage_telemetry (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  request_kind TEXT NOT NULL,
  input_preview TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  duration_ms INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_telemetry_created_at
  ON app.ai_usage_telemetry (created_at DESC);

ALTER TABLE app.food_log_item
  ADD COLUMN IF NOT EXISTS per100g_meta JSONB,
  ADD COLUMN IF NOT EXISTS totals_meta JSONB;

UPDATE app.food_log_item item
SET
  per100g_meta = COALESCE(
    item.per100g_meta,
    (
      SELECT jsonb_object_agg(
        entry.key,
        jsonb_build_object(
          'status',
          CASE
            WHEN item.source_kind = 'ai_fallback'
              AND jsonb_typeof(entry.value) = 'number' THEN 'estimated'
            WHEN entry.key IN ('energyKcal', 'proteinGrams', 'carbohydrateGrams', 'fatGrams')
              AND jsonb_typeof(entry.value) = 'number' THEN 'measured'
            WHEN jsonb_typeof(entry.value) = 'number'
              AND (entry.value::text)::numeric > 0 THEN 'measured'
            ELSE 'missing'
          END,
          'source',
          CASE
            WHEN item.source_kind = 'ai_fallback' THEN 'ai'
            ELSE 'database'
          END
        )
      )
      FROM jsonb_each(COALESCE(item.per100g_profile, '{}'::jsonb)) entry
    )
  ),
  totals_meta = COALESCE(
    item.totals_meta,
    (
      SELECT jsonb_object_agg(
        entry.key,
        jsonb_build_object(
          'status',
          CASE
            WHEN item.source_kind = 'ai_fallback'
              AND jsonb_typeof(entry.value) = 'number' THEN 'estimated'
            WHEN entry.key IN ('energyKcal', 'proteinGrams', 'carbohydrateGrams', 'fatGrams')
              AND jsonb_typeof(entry.value) = 'number' THEN 'measured'
            WHEN jsonb_typeof(entry.value) = 'number'
              AND (entry.value::text)::numeric > 0 THEN 'measured'
            ELSE 'missing'
          END,
          'source',
          CASE
            WHEN item.source_kind = 'ai_fallback' THEN 'ai'
            ELSE 'database'
          END
        )
      )
      FROM jsonb_each(COALESCE(item.totals_profile, '{}'::jsonb)) entry
    )
  )
WHERE item.per100g_meta IS NULL
   OR item.totals_meta IS NULL;

ALTER TABLE app.food_log_item
  ALTER COLUMN per100g_meta SET DEFAULT '{}'::jsonb,
  ALTER COLUMN totals_meta SET DEFAULT '{}'::jsonb,
  ALTER COLUMN per100g_meta SET NOT NULL,
  ALTER COLUMN totals_meta SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_matviews
    WHERE schemaname = 'core'
      AND matviewname = 'app_catalog_profile_23'
  ) THEN
    EXECUTE 'DROP MATERIALIZED VIEW core.app_catalog_profile_23';
  ELSIF EXISTS (
    SELECT 1
    FROM pg_views
    WHERE schemaname = 'core'
      AND viewname = 'app_catalog_profile_23'
  ) THEN
    EXECUTE 'DROP VIEW core.app_catalog_profile_23';
  END IF;
END;
$$;

DROP MATERIALIZED VIEW IF EXISTS core.app_food_profile_23 CASCADE;
DROP MATERIALIZED VIEW IF EXISTS core.app_recipe_profile_23 CASCADE;

CREATE MATERIALIZED VIEW core.app_food_profile_23 AS
WITH food_profile_base AS (
  SELECT
    cf.id AS canonical_food_id,
    sf.source_system,
    sf.source_food_id,
    sf.food_group,
    sf.source_category,
    sf.source_subcategory,
    cf.display_name_en AS food_name_en,
    cf.display_name_zh AS food_name_zh,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'energy_kcal') AS energy_kcal,
    BOOL_OR(fnv.nutrient_slug = 'energy_kcal' AND fnv.amount IS NOT NULL) AS energy_kcal_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'protein_g') AS protein_grams,
    BOOL_OR(fnv.nutrient_slug = 'protein_g' AND fnv.amount IS NOT NULL) AS protein_grams_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'fat_g') AS fat_grams,
    BOOL_OR(fnv.nutrient_slug = 'fat_g' AND fnv.amount IS NOT NULL) AS fat_grams_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'carbohydrate_g') AS carbohydrate_grams,
    BOOL_OR(fnv.nutrient_slug = 'carbohydrate_g' AND fnv.amount IS NOT NULL) AS carbohydrate_grams_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'fiber_g') AS fiber_grams,
    BOOL_OR(fnv.nutrient_slug = 'fiber_g' AND fnv.amount IS NOT NULL) AS fiber_grams_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'sugars_g') AS sugars_grams,
    BOOL_OR(fnv.nutrient_slug = 'sugars_g' AND fnv.amount IS NOT NULL) AS sugars_grams_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'sodium_mg') AS sodium_mg,
    BOOL_OR(fnv.nutrient_slug = 'sodium_mg' AND fnv.amount IS NOT NULL) AS sodium_mg_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'potassium_mg') AS potassium_mg,
    BOOL_OR(fnv.nutrient_slug = 'potassium_mg' AND fnv.amount IS NOT NULL) AS potassium_mg_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'calcium_mg') AS calcium_mg,
    BOOL_OR(fnv.nutrient_slug = 'calcium_mg' AND fnv.amount IS NOT NULL) AS calcium_mg_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'magnesium_mg') AS magnesium_mg,
    BOOL_OR(fnv.nutrient_slug = 'magnesium_mg' AND fnv.amount IS NOT NULL) AS magnesium_mg_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'iron_mg') AS iron_mg,
    BOOL_OR(fnv.nutrient_slug = 'iron_mg' AND fnv.amount IS NOT NULL) AS iron_mg_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'zinc_mg') AS zinc_mg,
    BOOL_OR(fnv.nutrient_slug = 'zinc_mg' AND fnv.amount IS NOT NULL) AS zinc_mg_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'vitamin_a_mcg') AS vitamin_a_mcg,
    BOOL_OR(fnv.nutrient_slug = 'vitamin_a_mcg' AND fnv.amount IS NOT NULL) AS vitamin_a_mcg_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'vitamin_c_mg') AS vitamin_c_mg,
    BOOL_OR(fnv.nutrient_slug = 'vitamin_c_mg' AND fnv.amount IS NOT NULL) AS vitamin_c_mg_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'vitamin_d_mcg') AS vitamin_d_mcg,
    BOOL_OR(fnv.nutrient_slug = 'vitamin_d_mcg' AND fnv.amount IS NOT NULL) AS vitamin_d_mcg_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'vitamin_e_mg') AS vitamin_e_mg,
    BOOL_OR(fnv.nutrient_slug = 'vitamin_e_mg' AND fnv.amount IS NOT NULL) AS vitamin_e_mg_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'vitamin_k_mcg') AS vitamin_k_mcg,
    BOOL_OR(fnv.nutrient_slug = 'vitamin_k_mcg' AND fnv.amount IS NOT NULL) AS vitamin_k_mcg_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'thiamin_mg') AS thiamin_mg,
    BOOL_OR(fnv.nutrient_slug = 'thiamin_mg' AND fnv.amount IS NOT NULL) AS thiamin_mg_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'riboflavin_mg') AS riboflavin_mg,
    BOOL_OR(fnv.nutrient_slug = 'riboflavin_mg' AND fnv.amount IS NOT NULL) AS riboflavin_mg_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'niacin_mg') AS niacin_mg,
    BOOL_OR(fnv.nutrient_slug = 'niacin_mg' AND fnv.amount IS NOT NULL) AS niacin_mg_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'vitamin_b6_mg') AS vitamin_b6_mg,
    BOOL_OR(fnv.nutrient_slug = 'vitamin_b6_mg' AND fnv.amount IS NOT NULL) AS vitamin_b6_mg_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'vitamin_b12_mcg') AS vitamin_b12_mcg,
    BOOL_OR(fnv.nutrient_slug = 'vitamin_b12_mcg' AND fnv.amount IS NOT NULL) AS vitamin_b12_mcg_is_present,
    MAX(fnv.amount) FILTER (WHERE fnv.nutrient_slug = 'folate_mcg') AS folate_mcg,
    BOOL_OR(fnv.nutrient_slug = 'folate_mcg' AND fnv.amount IS NOT NULL) AS folate_mcg_is_present,
    COALESCE(sf.serving_basis_g, 100::numeric) AS amount_basis_g,
    cf.completeness_ratio,
    cf.publish_ready,
    cf.coverage_status
  FROM core.canonical_food cf
  JOIN core.source_food sf
    ON sf.id = cf.primary_source_food_pk
  LEFT JOIN core.food_nutrient_value fnv
    ON fnv.source_food_pk = sf.id
  GROUP BY
    cf.id,
    sf.source_system,
    sf.source_food_id,
    sf.food_group,
    sf.source_category,
    sf.source_subcategory,
    cf.display_name_en,
    cf.display_name_zh,
    COALESCE(sf.serving_basis_g, 100::numeric),
    cf.completeness_ratio,
    cf.publish_ready,
    cf.coverage_status
)
SELECT
  food_profile_base.*,
  (
    COALESCE(food_profile_base.energy_kcal_is_present, FALSE)::int +
    COALESCE(food_profile_base.protein_grams_is_present, FALSE)::int +
    COALESCE(food_profile_base.fat_grams_is_present, FALSE)::int +
    COALESCE(food_profile_base.carbohydrate_grams_is_present, FALSE)::int
  ) AS macro_present_count,
  (
    COALESCE(food_profile_base.fiber_grams_is_present, FALSE)::int +
    COALESCE(food_profile_base.sugars_grams_is_present, FALSE)::int +
    COALESCE(food_profile_base.sodium_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.potassium_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.calcium_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.magnesium_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.iron_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.zinc_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.vitamin_a_mcg_is_present, FALSE)::int +
    COALESCE(food_profile_base.vitamin_c_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.vitamin_d_mcg_is_present, FALSE)::int +
    COALESCE(food_profile_base.vitamin_e_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.vitamin_k_mcg_is_present, FALSE)::int +
    COALESCE(food_profile_base.thiamin_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.riboflavin_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.niacin_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.vitamin_b6_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.vitamin_b12_mcg_is_present, FALSE)::int +
    COALESCE(food_profile_base.folate_mcg_is_present, FALSE)::int
  ) AS non_core_present_count,
  (
    COALESCE(food_profile_base.energy_kcal_is_present, FALSE)::int +
    COALESCE(food_profile_base.protein_grams_is_present, FALSE)::int +
    COALESCE(food_profile_base.fat_grams_is_present, FALSE)::int +
    COALESCE(food_profile_base.carbohydrate_grams_is_present, FALSE)::int +
    COALESCE(food_profile_base.fiber_grams_is_present, FALSE)::int +
    COALESCE(food_profile_base.sugars_grams_is_present, FALSE)::int +
    COALESCE(food_profile_base.sodium_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.potassium_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.calcium_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.magnesium_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.iron_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.zinc_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.vitamin_a_mcg_is_present, FALSE)::int +
    COALESCE(food_profile_base.vitamin_c_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.vitamin_d_mcg_is_present, FALSE)::int +
    COALESCE(food_profile_base.vitamin_e_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.vitamin_k_mcg_is_present, FALSE)::int +
    COALESCE(food_profile_base.thiamin_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.riboflavin_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.niacin_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.vitamin_b6_mg_is_present, FALSE)::int +
    COALESCE(food_profile_base.vitamin_b12_mcg_is_present, FALSE)::int +
    COALESCE(food_profile_base.folate_mcg_is_present, FALSE)::int
  ) AS measured_nutrient_count,
  NOW() AS materialized_at
FROM food_profile_base
WITH NO DATA;

CREATE UNIQUE INDEX idx_app_food_profile_23_pk
  ON core.app_food_profile_23 (canonical_food_id);

CREATE INDEX idx_app_food_profile_23_food_name_zh
  ON core.app_food_profile_23 (food_name_zh);

CREATE INDEX idx_app_food_profile_23_food_name_zh_trgm
  ON core.app_food_profile_23
  USING GIN (food_name_zh gin_trgm_ops);

CREATE MATERIALIZED VIEW core.app_recipe_profile_23 AS
WITH recipe_profile_base AS (
  SELECT
    r.id AS recipe_id,
    r.recipe_slug,
    r.food_group,
    r.recipe_type,
    r.cuisine,
    r.recipe_name_en AS food_name_en,
    r.recipe_name_zh AS food_name_zh,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'energy_kcal') AS energy_kcal,
    BOOL_OR(rns.nutrient_slug = 'energy_kcal' AND rns.amount IS NOT NULL) AS energy_kcal_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'protein_g') AS protein_grams,
    BOOL_OR(rns.nutrient_slug = 'protein_g' AND rns.amount IS NOT NULL) AS protein_grams_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'fat_g') AS fat_grams,
    BOOL_OR(rns.nutrient_slug = 'fat_g' AND rns.amount IS NOT NULL) AS fat_grams_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'carbohydrate_g') AS carbohydrate_grams,
    BOOL_OR(rns.nutrient_slug = 'carbohydrate_g' AND rns.amount IS NOT NULL) AS carbohydrate_grams_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'fiber_g') AS fiber_grams,
    BOOL_OR(rns.nutrient_slug = 'fiber_g' AND rns.amount IS NOT NULL) AS fiber_grams_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'sugars_g') AS sugars_grams,
    BOOL_OR(rns.nutrient_slug = 'sugars_g' AND rns.amount IS NOT NULL) AS sugars_grams_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'sodium_mg') AS sodium_mg,
    BOOL_OR(rns.nutrient_slug = 'sodium_mg' AND rns.amount IS NOT NULL) AS sodium_mg_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'potassium_mg') AS potassium_mg,
    BOOL_OR(rns.nutrient_slug = 'potassium_mg' AND rns.amount IS NOT NULL) AS potassium_mg_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'calcium_mg') AS calcium_mg,
    BOOL_OR(rns.nutrient_slug = 'calcium_mg' AND rns.amount IS NOT NULL) AS calcium_mg_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'magnesium_mg') AS magnesium_mg,
    BOOL_OR(rns.nutrient_slug = 'magnesium_mg' AND rns.amount IS NOT NULL) AS magnesium_mg_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'iron_mg') AS iron_mg,
    BOOL_OR(rns.nutrient_slug = 'iron_mg' AND rns.amount IS NOT NULL) AS iron_mg_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'zinc_mg') AS zinc_mg,
    BOOL_OR(rns.nutrient_slug = 'zinc_mg' AND rns.amount IS NOT NULL) AS zinc_mg_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'vitamin_a_mcg') AS vitamin_a_mcg,
    BOOL_OR(rns.nutrient_slug = 'vitamin_a_mcg' AND rns.amount IS NOT NULL) AS vitamin_a_mcg_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'vitamin_c_mg') AS vitamin_c_mg,
    BOOL_OR(rns.nutrient_slug = 'vitamin_c_mg' AND rns.amount IS NOT NULL) AS vitamin_c_mg_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'vitamin_d_mcg') AS vitamin_d_mcg,
    BOOL_OR(rns.nutrient_slug = 'vitamin_d_mcg' AND rns.amount IS NOT NULL) AS vitamin_d_mcg_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'vitamin_e_mg') AS vitamin_e_mg,
    BOOL_OR(rns.nutrient_slug = 'vitamin_e_mg' AND rns.amount IS NOT NULL) AS vitamin_e_mg_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'vitamin_k_mcg') AS vitamin_k_mcg,
    BOOL_OR(rns.nutrient_slug = 'vitamin_k_mcg' AND rns.amount IS NOT NULL) AS vitamin_k_mcg_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'thiamin_mg') AS thiamin_mg,
    BOOL_OR(rns.nutrient_slug = 'thiamin_mg' AND rns.amount IS NOT NULL) AS thiamin_mg_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'riboflavin_mg') AS riboflavin_mg,
    BOOL_OR(rns.nutrient_slug = 'riboflavin_mg' AND rns.amount IS NOT NULL) AS riboflavin_mg_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'niacin_mg') AS niacin_mg,
    BOOL_OR(rns.nutrient_slug = 'niacin_mg' AND rns.amount IS NOT NULL) AS niacin_mg_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'vitamin_b6_mg') AS vitamin_b6_mg,
    BOOL_OR(rns.nutrient_slug = 'vitamin_b6_mg' AND rns.amount IS NOT NULL) AS vitamin_b6_mg_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'vitamin_b12_mcg') AS vitamin_b12_mcg,
    BOOL_OR(rns.nutrient_slug = 'vitamin_b12_mcg' AND rns.amount IS NOT NULL) AS vitamin_b12_mcg_is_present,
    MAX(rns.amount) FILTER (WHERE rns.nutrient_slug = 'folate_mcg') AS folate_mcg,
    BOOL_OR(rns.nutrient_slug = 'folate_mcg' AND rns.amount IS NOT NULL) AS folate_mcg_is_present,
    r.amount_basis_g,
    r.completeness_ratio,
    r.publish_ready,
    r.coverage_status
  FROM core.recipe r
  LEFT JOIN core.recipe_nutrient_snapshot rns
    ON rns.recipe_id = r.id
  GROUP BY
    r.id,
    r.recipe_slug,
    r.food_group,
    r.recipe_type,
    r.cuisine,
    r.recipe_name_en,
    r.recipe_name_zh,
    r.amount_basis_g,
    r.completeness_ratio,
    r.publish_ready,
    r.coverage_status
)
SELECT
  recipe_profile_base.*,
  (
    COALESCE(recipe_profile_base.energy_kcal_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.protein_grams_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.fat_grams_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.carbohydrate_grams_is_present, FALSE)::int
  ) AS macro_present_count,
  (
    COALESCE(recipe_profile_base.fiber_grams_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.sugars_grams_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.sodium_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.potassium_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.calcium_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.magnesium_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.iron_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.zinc_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.vitamin_a_mcg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.vitamin_c_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.vitamin_d_mcg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.vitamin_e_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.vitamin_k_mcg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.thiamin_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.riboflavin_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.niacin_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.vitamin_b6_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.vitamin_b12_mcg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.folate_mcg_is_present, FALSE)::int
  ) AS non_core_present_count,
  (
    COALESCE(recipe_profile_base.energy_kcal_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.protein_grams_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.fat_grams_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.carbohydrate_grams_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.fiber_grams_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.sugars_grams_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.sodium_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.potassium_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.calcium_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.magnesium_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.iron_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.zinc_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.vitamin_a_mcg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.vitamin_c_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.vitamin_d_mcg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.vitamin_e_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.vitamin_k_mcg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.thiamin_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.riboflavin_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.niacin_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.vitamin_b6_mg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.vitamin_b12_mcg_is_present, FALSE)::int +
    COALESCE(recipe_profile_base.folate_mcg_is_present, FALSE)::int
  ) AS measured_nutrient_count,
  NOW() AS materialized_at
FROM recipe_profile_base
WITH NO DATA;

CREATE UNIQUE INDEX idx_app_recipe_profile_23_pk
  ON core.app_recipe_profile_23 (recipe_id);

CREATE INDEX idx_app_recipe_profile_23_food_name_zh
  ON core.app_recipe_profile_23 (food_name_zh);

CREATE INDEX idx_app_recipe_profile_23_food_name_zh_trgm
  ON core.app_recipe_profile_23
  USING GIN (food_name_zh gin_trgm_ops);

CREATE MATERIALIZED VIEW core.app_catalog_profile_23 AS
SELECT
  'food'::text AS entity_type,
  afp.canonical_food_id AS entity_id,
  NULL::text AS entity_slug,
  afp.source_system,
  afp.source_food_id AS source_item_id,
  afp.food_group,
  afp.source_category,
  afp.source_subcategory,
  afp.food_name_en,
  afp.food_name_zh,
  afp.energy_kcal,
  afp.protein_grams,
  afp.fat_grams,
  afp.carbohydrate_grams,
  afp.fiber_grams,
  afp.sugars_grams,
  afp.sodium_mg,
  afp.potassium_mg,
  afp.calcium_mg,
  afp.magnesium_mg,
  afp.iron_mg,
  afp.zinc_mg,
  afp.vitamin_a_mcg,
  afp.vitamin_c_mg,
  afp.vitamin_d_mcg,
  afp.vitamin_e_mg,
  afp.vitamin_k_mcg,
  afp.thiamin_mg,
  afp.riboflavin_mg,
  afp.niacin_mg,
  afp.vitamin_b6_mg,
  afp.vitamin_b12_mcg,
  afp.folate_mcg,
  afp.energy_kcal_is_present,
  afp.protein_grams_is_present,
  afp.carbohydrate_grams_is_present,
  afp.fat_grams_is_present,
  afp.fiber_grams_is_present,
  afp.sugars_grams_is_present,
  afp.sodium_mg_is_present,
  afp.potassium_mg_is_present,
  afp.calcium_mg_is_present,
  afp.magnesium_mg_is_present,
  afp.iron_mg_is_present,
  afp.zinc_mg_is_present,
  afp.vitamin_a_mcg_is_present,
  afp.vitamin_c_mg_is_present,
  afp.vitamin_d_mcg_is_present,
  afp.vitamin_e_mg_is_present,
  afp.vitamin_k_mcg_is_present,
  afp.thiamin_mg_is_present,
  afp.riboflavin_mg_is_present,
  afp.niacin_mg_is_present,
  afp.vitamin_b6_mg_is_present,
  afp.vitamin_b12_mcg_is_present,
  afp.folate_mcg_is_present,
  afp.amount_basis_g,
  afp.completeness_ratio,
  afp.publish_ready,
  afp.coverage_status,
  afp.macro_present_count,
  afp.non_core_present_count,
  afp.measured_nutrient_count,
  afp.materialized_at
FROM core.app_food_profile_23 afp
UNION ALL
SELECT
  'recipe'::text AS entity_type,
  arp.recipe_id AS entity_id,
  arp.recipe_slug AS entity_slug,
  'standard_recipe'::text AS source_system,
  arp.recipe_slug AS source_item_id,
  arp.food_group,
  arp.recipe_type AS source_category,
  arp.cuisine AS source_subcategory,
  arp.food_name_en,
  arp.food_name_zh,
  arp.energy_kcal,
  arp.protein_grams,
  arp.fat_grams,
  arp.carbohydrate_grams,
  arp.fiber_grams,
  arp.sugars_grams,
  arp.sodium_mg,
  arp.potassium_mg,
  arp.calcium_mg,
  arp.magnesium_mg,
  arp.iron_mg,
  arp.zinc_mg,
  arp.vitamin_a_mcg,
  arp.vitamin_c_mg,
  arp.vitamin_d_mcg,
  arp.vitamin_e_mg,
  arp.vitamin_k_mcg,
  arp.thiamin_mg,
  arp.riboflavin_mg,
  arp.niacin_mg,
  arp.vitamin_b6_mg,
  arp.vitamin_b12_mcg,
  arp.folate_mcg,
  arp.energy_kcal_is_present,
  arp.protein_grams_is_present,
  arp.carbohydrate_grams_is_present,
  arp.fat_grams_is_present,
  arp.fiber_grams_is_present,
  arp.sugars_grams_is_present,
  arp.sodium_mg_is_present,
  arp.potassium_mg_is_present,
  arp.calcium_mg_is_present,
  arp.magnesium_mg_is_present,
  arp.iron_mg_is_present,
  arp.zinc_mg_is_present,
  arp.vitamin_a_mcg_is_present,
  arp.vitamin_c_mg_is_present,
  arp.vitamin_d_mcg_is_present,
  arp.vitamin_e_mg_is_present,
  arp.vitamin_k_mcg_is_present,
  arp.thiamin_mg_is_present,
  arp.riboflavin_mg_is_present,
  arp.niacin_mg_is_present,
  arp.vitamin_b6_mg_is_present,
  arp.vitamin_b12_mcg_is_present,
  arp.folate_mcg_is_present,
  arp.amount_basis_g,
  arp.completeness_ratio,
  arp.publish_ready,
  arp.coverage_status,
  arp.macro_present_count,
  arp.non_core_present_count,
  arp.measured_nutrient_count,
  arp.materialized_at
FROM core.app_recipe_profile_23 arp
WITH NO DATA;

CREATE UNIQUE INDEX idx_app_catalog_profile_23_entity
  ON core.app_catalog_profile_23 (entity_type, entity_id);

CREATE INDEX idx_app_catalog_profile_23_food_name_zh
  ON core.app_catalog_profile_23 (food_name_zh);

CREATE INDEX idx_app_catalog_profile_23_food_name_zh_trgm
  ON core.app_catalog_profile_23
  USING GIN (food_name_zh gin_trgm_ops);
