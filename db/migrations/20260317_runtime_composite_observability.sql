CREATE TABLE IF NOT EXISTS app.food_parse_telemetry (
  id BIGSERIAL PRIMARY KEY,
  source_description TEXT NOT NULL,
  segment_count INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  composite_segment_count INTEGER NOT NULL DEFAULT 0,
  db_exact_item_count INTEGER NOT NULL DEFAULT 0,
  db_fuzzy_item_count INTEGER NOT NULL DEFAULT 0,
  ai_fallback_item_count INTEGER NOT NULL DEFAULT 0,
  runtime_composite_item_count INTEGER NOT NULL DEFAULT 0,
  total_weight_g NUMERIC(12,2),
  overall_confidence NUMERIC(6,4),
  total_energy_kcal NUMERIC(12,2),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_parse_telemetry_created_at
  ON app.food_parse_telemetry (created_at DESC);

CREATE TABLE IF NOT EXISTS app.runtime_error_telemetry (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL,
  error_code TEXT NOT NULL,
  message TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runtime_error_telemetry_created_at
  ON app.runtime_error_telemetry (created_at DESC);

CREATE TABLE IF NOT EXISTS app.materialized_view_refresh_state (
  scope TEXT PRIMARY KEY,
  refresh_pending BOOLEAN NOT NULL DEFAULT FALSE,
  pending_reason TEXT,
  requested_at TIMESTAMPTZ,
  last_refreshed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app.materialized_view_refresh_state (scope, refresh_pending, updated_at)
VALUES ('nutrition_runtime', FALSE, NOW())
ON CONFLICT (scope) DO NOTHING;

CREATE OR REPLACE FUNCTION app.mark_materialized_view_refresh_pending(
  refresh_scope TEXT,
  refresh_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO app.materialized_view_refresh_state (
    scope,
    refresh_pending,
    pending_reason,
    requested_at,
    updated_at
  )
  VALUES (
    refresh_scope,
    TRUE,
    refresh_reason,
    NOW(),
    NOW()
  )
  ON CONFLICT (scope) DO UPDATE
  SET
    refresh_pending = TRUE,
    pending_reason = COALESCE(EXCLUDED.pending_reason, app.materialized_view_refresh_state.pending_reason),
    requested_at = COALESCE(app.materialized_view_refresh_state.requested_at, NOW()),
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION app.clear_materialized_view_refresh_pending(
  refresh_scope TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO app.materialized_view_refresh_state (
    scope,
    refresh_pending,
    pending_reason,
    requested_at,
    last_refreshed_at,
    updated_at
  )
  VALUES (
    refresh_scope,
    FALSE,
    NULL,
    NULL,
    NOW(),
    NOW()
  )
  ON CONFLICT (scope) DO UPDATE
  SET
    refresh_pending = FALSE,
    pending_reason = NULL,
    requested_at = NULL,
    last_refreshed_at = NOW(),
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION app.mark_nutrition_runtime_refresh_pending()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM app.mark_materialized_view_refresh_pending(
    'nutrition_runtime',
    format('%s.%s changed', TG_TABLE_SCHEMA, TG_TABLE_NAME)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_canonical_food_mark_refresh_pending ON core.canonical_food;
CREATE TRIGGER trg_canonical_food_mark_refresh_pending
AFTER INSERT OR UPDATE OR DELETE ON core.canonical_food
FOR EACH STATEMENT
EXECUTE FUNCTION app.mark_nutrition_runtime_refresh_pending();

DROP TRIGGER IF EXISTS trg_source_food_mark_refresh_pending ON core.source_food;
CREATE TRIGGER trg_source_food_mark_refresh_pending
AFTER INSERT OR UPDATE OR DELETE ON core.source_food
FOR EACH STATEMENT
EXECUTE FUNCTION app.mark_nutrition_runtime_refresh_pending();

DROP TRIGGER IF EXISTS trg_food_nutrient_value_mark_refresh_pending ON core.food_nutrient_value;
CREATE TRIGGER trg_food_nutrient_value_mark_refresh_pending
AFTER INSERT OR UPDATE OR DELETE ON core.food_nutrient_value
FOR EACH STATEMENT
EXECUTE FUNCTION app.mark_nutrition_runtime_refresh_pending();

DROP TRIGGER IF EXISTS trg_recipe_mark_refresh_pending ON core.recipe;
CREATE TRIGGER trg_recipe_mark_refresh_pending
AFTER INSERT OR UPDATE OR DELETE ON core.recipe
FOR EACH STATEMENT
EXECUTE FUNCTION app.mark_nutrition_runtime_refresh_pending();

DROP TRIGGER IF EXISTS trg_recipe_nutrient_snapshot_mark_refresh_pending ON core.recipe_nutrient_snapshot;
CREATE TRIGGER trg_recipe_nutrient_snapshot_mark_refresh_pending
AFTER INSERT OR UPDATE OR DELETE ON core.recipe_nutrient_snapshot
FOR EACH STATEMENT
EXECUTE FUNCTION app.mark_nutrition_runtime_refresh_pending();

DROP TRIGGER IF EXISTS trg_recipe_ingredient_mark_refresh_pending ON core.recipe_ingredient;
CREATE TRIGGER trg_recipe_ingredient_mark_refresh_pending
AFTER INSERT OR UPDATE OR DELETE ON core.recipe_ingredient
FOR EACH STATEMENT
EXECUTE FUNCTION app.mark_nutrition_runtime_refresh_pending();

CREATE INDEX IF NOT EXISTS idx_recipe_ingredient_recipe_id
  ON core.recipe_ingredient (recipe_id);
