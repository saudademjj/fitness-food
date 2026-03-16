CREATE SCHEMA IF NOT EXISTS app;

ALTER TABLE core.portion_reference
  ADD COLUMN IF NOT EXISTS size_multipliers JSONB NOT NULL DEFAULT '{"小": 0.75, "中": 1.0, "大": 1.35, "超大": 1.6}'::jsonb,
  ADD COLUMN IF NOT EXISTS preparation_multipliers JSONB NOT NULL DEFAULT '{"生": 1.0, "熟": 0.92, "煮": 1.0, "蒸": 0.95, "炒": 1.08, "炸": 0.9, "烤": 0.88, "炖": 1.1, "汤": 1.2}'::jsonb,
  ADD COLUMN IF NOT EXISTS density_g_per_ml NUMERIC(12, 4),
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(6, 4) NOT NULL DEFAULT 0.8;

UPDATE core.portion_reference
SET
  size_multipliers = COALESCE(size_multipliers, '{"小": 0.75, "中": 1.0, "大": 1.35, "超大": 1.6}'::jsonb),
  preparation_multipliers = COALESCE(preparation_multipliers, '{"生": 1.0, "熟": 0.92, "煮": 1.0, "蒸": 0.95, "炒": 1.08, "炸": 0.9, "烤": 0.88, "炖": 1.1, "汤": 1.2}'::jsonb),
  confidence_score = COALESCE(confidence_score, 0.9)
WHERE TRUE;

ALTER TABLE app.food_log_item
  ADD COLUMN IF NOT EXISTS per100g_profile JSONB,
  ADD COLUMN IF NOT EXISTS totals_profile JSONB;

UPDATE app.food_log_item
SET
  per100g_profile = jsonb_build_object(
    'energyKcal', energy_kcal,
    'proteinGrams', protein_grams,
    'carbohydrateGrams', carbohydrate_grams,
    'fatGrams', fat_grams,
    'fiberGrams', 0,
    'sugarsGrams', 0,
    'sodiumMg', 0,
    'potassiumMg', 0,
    'calciumMg', 0,
    'magnesiumMg', 0,
    'ironMg', 0,
    'zincMg', 0,
    'vitaminAMcg', 0,
    'vitaminCMg', 0,
    'vitaminDMcg', 0,
    'vitaminEMg', 0,
    'vitaminKMcg', 0,
    'thiaminMg', 0,
    'riboflavinMg', 0,
    'niacinMg', 0,
    'vitaminB6Mg', 0,
    'vitaminB12Mcg', 0,
    'folateMcg', 0
  ),
  totals_profile = jsonb_build_object(
    'energyKcal', total_energy_kcal,
    'proteinGrams', total_protein_grams,
    'carbohydrateGrams', total_carbohydrate_grams,
    'fatGrams', total_fat_grams,
    'fiberGrams', 0,
    'sugarsGrams', 0,
    'sodiumMg', 0,
    'potassiumMg', 0,
    'calciumMg', 0,
    'magnesiumMg', 0,
    'ironMg', 0,
    'zincMg', 0,
    'vitaminAMcg', 0,
    'vitaminCMg', 0,
    'vitaminDMcg', 0,
    'vitaminEMg', 0,
    'vitaminKMcg', 0,
    'thiaminMg', 0,
    'riboflavinMg', 0,
    'niacinMg', 0,
    'vitaminB6Mg', 0,
    'vitaminB12Mcg', 0,
    'folateMcg', 0
  )
WHERE per100g_profile IS NULL
   OR totals_profile IS NULL;

ALTER TABLE app.food_log_item
  ALTER COLUMN per100g_profile SET DEFAULT '{}'::jsonb,
  ALTER COLUMN totals_profile SET DEFAULT '{}'::jsonb,
  ALTER COLUMN per100g_profile SET NOT NULL,
  ALTER COLUMN totals_profile SET NOT NULL;

CREATE TABLE IF NOT EXISTS app.lookup_miss_telemetry (
  normalized_food_name TEXT PRIMARY KEY,
  latest_raw_food_name TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lookup_miss_telemetry_last_seen
  ON app.lookup_miss_telemetry (last_seen_at DESC);

WITH candidate_rows AS (
  SELECT DISTINCT ON (regexp_replace(lower(ac.food_name_zh), '\s+', '', 'g'))
    ac.food_name_zh,
    regexp_replace(lower(ac.food_name_zh), '\s+', '', 'g') AS normalized_name_zh,
    CASE
      WHEN ac.food_name_zh ~ '(豆浆|牛奶|酸奶|奶茶|咖啡|果汁|可乐|雪碧|芬达|饮料|茶)' THEN 300
      WHEN ac.food_name_zh ~ '(苹果|香蕉|橙子|梨|桃|芒果|葡萄|猕猴桃|草莓)' THEN 180
      WHEN ac.food_name_zh ~ '(西瓜|哈密瓜|菠萝)' THEN 250
      WHEN ac.food_name_zh ~ '(鸡蛋|鸭蛋|鹅蛋|鹌鹑蛋)' THEN 50
      WHEN ac.food_name_zh ~ '(米饭|白饭)' THEN 180
      WHEN ac.food_name_zh ~ '(炒饭|盖饭|焗饭|便当|套餐)' THEN 320
      WHEN ac.food_name_zh ~ '(面条|拉面|炒面|拌面|意面|热干面|炸酱面)' THEN 320
      WHEN ac.food_name_zh ~ '(米线|河粉|粉丝|酸辣粉)' THEN 380
      WHEN ac.food_name_zh ~ '(螺蛳粉)' THEN 450
      WHEN ac.food_name_zh ~ '(肠粉)' THEN 250
      WHEN ac.food_name_zh ~ '(煎饼果子|煎饼馃子)' THEN 280
      WHEN ac.food_name_zh ~ '(粥|白粥|小米粥|南瓜粥)' THEN 300
      WHEN ac.food_name_zh ~ '(汤|排骨汤|蛋花汤)' THEN 380
      WHEN ac.food_name_zh ~ '(麻辣烫)' THEN 650
      WHEN ac.food_name_zh ~ '(火锅)' THEN 700
      WHEN ac.food_name_zh ~ '(包子|馒头|烧麦)' THEN 110
      WHEN ac.food_name_zh ~ '(饺子|锅贴)' THEN 25
      WHEN ac.food_name_zh ~ '(馄饨|汤圆)' THEN 20
      WHEN ac.food_name_zh ~ '(汉堡|三明治|卷饼)' THEN 220
      WHEN ac.food_name_zh ~ '(披萨)' THEN 320
      WHEN ac.food_name_zh ~ '(蛋糕|芝士蛋糕|慕斯蛋糕)' THEN 90
      WHEN ac.food_name_zh ~ '(蛋挞|葡式蛋挞)' THEN 55
      WHEN ac.food_name_zh ~ '(牛排|鸡胸肉|鸡腿|鸡翅|鱼排|羊肉串|牛肉串|鸡肉串|宫保鸡丁|番茄炒蛋|红烧肉|回锅肉|麻婆豆腐|鱼香肉丝)' THEN 180
      WHEN ac.food_name_zh ~ '(炸鸡块|鸡块|麦乐鸡)' THEN 45
      WHEN ac.food_name_zh ~ '(薯条)' THEN 110
      WHEN ac.food_name_zh ~ '(玉米|红薯|土豆)' THEN 200
      ELSE NULL
    END AS default_grams,
    CASE
      WHEN ac.food_name_zh ~ '(豆浆|牛奶|酸奶|奶茶|咖啡|果汁|可乐|雪碧|芬达|饮料|茶)' THEN '{"杯": 300, "盒": 250, "瓶": 500, "罐": 330, "ml": 1.0, "毫升": 1.0}'::jsonb
      WHEN ac.food_name_zh ~ '(苹果|香蕉|橙子|梨|桃|芒果|葡萄|猕猴桃|草莓)' THEN '{"个": 180, "只": 180, "根": 120}'::jsonb
      WHEN ac.food_name_zh ~ '(西瓜|哈密瓜|菠萝)' THEN '{"块": 250, "片": 180}'::jsonb
      WHEN ac.food_name_zh ~ '(鸡蛋|鸭蛋|鹅蛋|鹌鹑蛋)' THEN '{"个": 50, "只": 50, "颗": 50}'::jsonb
      WHEN ac.food_name_zh ~ '(米饭|白饭)' THEN '{"碗": 180, "份": 180}'::jsonb
      WHEN ac.food_name_zh ~ '(炒饭|盖饭|焗饭|便当|套餐)' THEN '{"盘": 320, "份": 320, "碗": 300}'::jsonb
      WHEN ac.food_name_zh ~ '(面条|拉面|炒面|拌面|意面|热干面|炸酱面)' THEN '{"碗": 320, "份": 320}'::jsonb
      WHEN ac.food_name_zh ~ '(米线|河粉|粉丝|酸辣粉)' THEN '{"碗": 380, "份": 380}'::jsonb
      WHEN ac.food_name_zh ~ '(螺蛳粉)' THEN '{"碗": 450, "份": 450}'::jsonb
      WHEN ac.food_name_zh ~ '(肠粉)' THEN '{"份": 250, "盘": 250}'::jsonb
      WHEN ac.food_name_zh ~ '(煎饼果子|煎饼馃子)' THEN '{"份": 280, "个": 280}'::jsonb
      WHEN ac.food_name_zh ~ '(粥|白粥|小米粥|南瓜粥)' THEN '{"碗": 300, "杯": 300}'::jsonb
      WHEN ac.food_name_zh ~ '(汤|排骨汤|蛋花汤)' THEN '{"碗": 380, "份": 380}'::jsonb
      WHEN ac.food_name_zh ~ '(麻辣烫)' THEN '{"份": 650, "碗": 650, "盒": 700}'::jsonb
      WHEN ac.food_name_zh ~ '(火锅)' THEN '{"份": 700, "锅": 900}'::jsonb
      WHEN ac.food_name_zh ~ '(包子|馒头|烧麦)' THEN '{"个": 110, "只": 110}'::jsonb
      WHEN ac.food_name_zh ~ '(饺子|锅贴)' THEN '{"个": 25, "只": 25}'::jsonb
      WHEN ac.food_name_zh ~ '(馄饨|汤圆)' THEN '{"个": 20, "只": 20, "碗": 240}'::jsonb
      WHEN ac.food_name_zh ~ '(汉堡|三明治|卷饼)' THEN '{"个": 220, "份": 220, "只": 220}'::jsonb
      WHEN ac.food_name_zh ~ '(披萨)' THEN '{"份": 320, "片": 120, "块": 120}'::jsonb
      WHEN ac.food_name_zh ~ '(蛋糕|芝士蛋糕|慕斯蛋糕)' THEN '{"块": 90, "片": 90, "份": 100}'::jsonb
      WHEN ac.food_name_zh ~ '(蛋挞|葡式蛋挞)' THEN '{"个": 55, "只": 55}'::jsonb
      WHEN ac.food_name_zh ~ '(羊肉串|牛肉串|鸡肉串)' THEN '{"串": 35, "根": 35}'::jsonb
      WHEN ac.food_name_zh ~ '(牛排|鸡胸肉|鸡腿|鸡翅|鱼排|宫保鸡丁|番茄炒蛋|红烧肉|回锅肉|麻婆豆腐|鱼香肉丝)' THEN '{"份": 180, "盘": 200, "块": 150, "片": 120}'::jsonb
      WHEN ac.food_name_zh ~ '(炸鸡块|鸡块|麦乐鸡)' THEN '{"块": 45, "个": 45, "份": 270}'::jsonb
      WHEN ac.food_name_zh ~ '(薯条)' THEN '{"份": 110, "包": 110}'::jsonb
      WHEN ac.food_name_zh ~ '(玉米|红薯|土豆)' THEN '{"根": 180, "个": 200, "只": 200, "块": 100}'::jsonb
      ELSE '{}'::jsonb
    END AS unit_grams,
    ARRAY[ac.food_name_zh]::text[] AS keyword_patterns,
    CASE
      WHEN ac.food_name_zh ~ '(豆浆|牛奶|酸奶|奶茶|咖啡|果汁|可乐|雪碧|芬达|饮料|茶)' THEN 1.02
      ELSE NULL
    END AS density_g_per_ml,
    CASE
      WHEN ac.food_name_zh ~ '(米饭|白饭|鸡蛋|豆浆|牛奶|酸奶|包子|馒头|粥|面条|拉面|蛋糕|蛋挞|汉堡|三明治|披萨|肠粉|煎饼果子|螺蛳粉)' THEN 0.88
      ELSE 0.72
    END AS confidence_score
  FROM core.app_catalog_profile_23 ac
  WHERE ac.publish_ready = TRUE
    AND ac.food_name_zh IS NOT NULL
    AND ac.food_name_zh ~ '(豆浆|牛奶|酸奶|奶茶|咖啡|果汁|可乐|雪碧|芬达|饮料|茶|苹果|香蕉|橙子|梨|桃|芒果|葡萄|猕猴桃|草莓|西瓜|哈密瓜|菠萝|鸡蛋|鸭蛋|鹅蛋|鹌鹑蛋|米饭|白饭|炒饭|盖饭|焗饭|便当|套餐|面条|拉面|炒面|拌面|意面|热干面|炸酱面|米线|河粉|粉丝|酸辣粉|螺蛳粉|肠粉|煎饼果子|煎饼馃子|粥|白粥|小米粥|南瓜粥|汤|排骨汤|蛋花汤|麻辣烫|火锅|包子|馒头|烧麦|饺子|锅贴|馄饨|汤圆|汉堡|三明治|卷饼|披萨|蛋糕|芝士蛋糕|慕斯蛋糕|蛋挞|葡式蛋挞|牛排|鸡胸肉|鸡腿|鸡翅|鱼排|羊肉串|牛肉串|鸡肉串|宫保鸡丁|番茄炒蛋|红烧肉|回锅肉|麻婆豆腐|鱼香肉丝|炸鸡块|鸡块|麦乐鸡|薯条|玉米|红薯|土豆)'
  ORDER BY regexp_replace(lower(ac.food_name_zh), '\s+', '', 'g'), ac.completeness_ratio DESC NULLS LAST
)
INSERT INTO core.portion_reference (
  food_name_zh,
  normalized_name_zh,
  default_grams,
  unit_grams,
  keyword_patterns,
  size_multipliers,
  preparation_multipliers,
  density_g_per_ml,
  confidence_score,
  reference_source,
  notes,
  priority
)
SELECT
  food_name_zh,
  normalized_name_zh,
  default_grams,
  unit_grams,
  keyword_patterns,
  '{"小": 0.75, "中": 1.0, "大": 1.35, "超大": 1.6}'::jsonb,
  '{"生": 1.0, "熟": 0.92, "煮": 1.0, "蒸": 0.95, "炒": 1.08, "炸": 0.9, "烤": 0.88, "炖": 1.1, "汤": 1.2}'::jsonb,
  density_g_per_ml,
  confidence_score,
  'fitness_food_bulk_seed',
  'Auto-seeded from publish_ready catalog heuristics',
  60
FROM candidate_rows
WHERE default_grams IS NOT NULL
ON CONFLICT (normalized_name_zh) DO UPDATE
SET
  unit_grams = EXCLUDED.unit_grams,
  size_multipliers = EXCLUDED.size_multipliers,
  preparation_multipliers = EXCLUDED.preparation_multipliers,
  density_g_per_ml = EXCLUDED.density_g_per_ml,
  confidence_score = GREATEST(core.portion_reference.confidence_score, EXCLUDED.confidence_score),
  updated_at = NOW()
WHERE core.portion_reference.priority >= 60;
