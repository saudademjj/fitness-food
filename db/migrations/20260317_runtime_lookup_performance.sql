CREATE INDEX IF NOT EXISTS idx_app_catalog_profile_23_food_name_zh_normalized_trgm
  ON core.app_catalog_profile_23
  USING GIN (regexp_replace(lower(COALESCE(food_name_zh, '')), '\s+', '', 'g') gin_trgm_ops);
