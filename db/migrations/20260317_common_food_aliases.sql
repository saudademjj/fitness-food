INSERT INTO core.canonical_food_alias (
  canonical_food_id,
  alias_text,
  normalized_alias,
  language_code,
  alias_type,
  provenance,
  confidence
)
SELECT
  ac.entity_id,
  seed.alias_text,
  regexp_replace(lower(seed.alias_text), '\s+', '', 'g'),
  'zh',
  'seeded_common_alias',
  'fitness_food_common_alias_seed',
  seed.confidence
FROM (
  VALUES
    ('米饭', '米饭，熟，未进一步说明', 0.98),
    ('白米饭', '米饭，熟，未进一步说明', 0.98),
    ('鸡蛋', '鸡蛋，全蛋，熟制，烹饪方法未说明', 0.97),
    ('煮蛋', '鸡蛋，全蛋，熟制，硬煮', 0.98),
    ('水煮蛋', '鸡蛋，全蛋，熟制，硬煮', 0.98),
    ('炒蛋', '鸡蛋，全蛋，熟制，炒蛋', 0.98),
    ('煎蛋', '鸡蛋，全蛋，熟制，煎', 0.98),
    ('苹果', '生苹果', 0.96),
    ('香蕉', '香蕉，生', 0.98),
    ('番茄', '番茄，红色，成熟，生，全年平均', 0.97),
    ('西红柿', '番茄，红色，成熟，生，全年平均', 0.97),
    ('红薯', '红薯，熟制，煮，去皮', 0.96),
    ('鸡胸肉', '鸡胸肉，无酱烤制，去皮食用', 0.94),
    ('面条', '面条，煮熟', 0.95),
    ('米线', '米粉，熟', 0.95),
    ('燕麦', '燕麦片，未进一步指定', 0.94),
    ('炒饭', '炒饭，未进一步说明', 0.97),
    ('蛋炒饭', '炒饭，无肉', 0.94),
    ('可乐', '饮料，碳酸，可乐，常规', 0.98),
    ('咖啡', '咖啡，冲泡', 0.97),
    ('美式咖啡', '咖啡，冲泡', 0.97)
) AS seed(alias_text, matched_food_name, confidence)
JOIN core.app_catalog_profile_23 ac
  ON ac.entity_type = 'food'
 AND ac.publish_ready = TRUE
 AND ac.food_name_zh = seed.matched_food_name
WHERE NOT EXISTS (
  SELECT 1
  FROM core.canonical_food_alias existing
  WHERE existing.canonical_food_id = ac.entity_id
    AND existing.normalized_alias = regexp_replace(lower(seed.alias_text), '\s+', '', 'g')
    AND existing.language_code = 'zh'
    AND existing.provenance = 'fitness_food_common_alias_seed'
);

INSERT INTO core.recipe_alias (
  recipe_id,
  alias_text,
  normalized_alias,
  language_code,
  alias_type,
  provenance,
  confidence
)
SELECT
  ac.entity_id,
  seed.alias_text,
  regexp_replace(lower(seed.alias_text), '\s+', '', 'g'),
  'zh',
  'seeded_common_recipe_alias',
  'fitness_food_common_alias_seed',
  seed.confidence
FROM (
  VALUES
    ('肉包', 0.97),
    ('肉包子', 0.98),
    ('猪肉包', 0.98),
    ('鲜肉包', 0.98)
) AS seed(alias_text, confidence)
JOIN core.app_catalog_profile_23 ac
  ON ac.entity_type = 'recipe'
 AND ac.publish_ready = TRUE
 AND ac.food_name_zh = '猪肉包子'
ON CONFLICT (recipe_id, normalized_alias, language_code, provenance) DO NOTHING;

SELECT app.bump_runtime_cache_state('lookup');
