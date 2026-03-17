CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE INDEX IF NOT EXISTS idx_recipe_alias_alias_text_lookup
  ON core.recipe_alias (alias_text, language_code);

CREATE INDEX IF NOT EXISTS idx_canonical_food_alias_alias_text_lookup
  ON core.canonical_food_alias (alias_text, language_code);

CREATE INDEX IF NOT EXISTS idx_app_food_profile_23_food_name_zh
  ON core.app_food_profile_23 (food_name_zh)
  WHERE food_name_zh IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_recipe_profile_23_food_name_zh
  ON core.app_recipe_profile_23 (food_name_zh)
  WHERE food_name_zh IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_food_profile_23_food_name_zh_trgm
  ON core.app_food_profile_23
  USING GIN (regexp_replace(lower(COALESCE(food_name_zh, '')), '\s+', '', 'g') gin_trgm_ops)
  WHERE food_name_zh IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_recipe_profile_23_food_name_zh_trgm
  ON core.app_recipe_profile_23
  USING GIN (regexp_replace(lower(COALESCE(food_name_zh, '')), '\s+', '', 'g') gin_trgm_ops)
  WHERE food_name_zh IS NOT NULL;
