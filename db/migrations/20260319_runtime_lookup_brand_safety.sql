UPDATE core.canonical_food
SET publish_ready = FALSE
WHERE id = '9adfee49-7160-4ca8-8dab-e1599faeb951'::uuid
  AND publish_ready = TRUE;

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
  '0012cd45-340c-49e3-9f53-4627ca9736fc'::uuid,
  seed.alias_text,
  regexp_replace(lower(seed.alias_text), '\s+', '', 'g'),
  seed.language_code,
  'seeded_runtime_alias',
  'fitness_food_brand_safety',
  seed.confidence
FROM (
  VALUES
    ('可口可乐', 'zh', 0.99::numeric),
    ('Coca-Cola', 'en', 0.95::numeric),
    ('cocacola', 'en', 0.9::numeric)
) AS seed(alias_text, language_code, confidence)
ON CONFLICT (canonical_food_id, normalized_alias, language_code, provenance) DO NOTHING;

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
VALUES (
  '麦乐鸡',
  regexp_replace(lower('麦乐鸡'), '\s+', '', 'g'),
  80,
  '{"份": 80, "块": 16, "个": 16, "g": 1, "克": 1}'::jsonb,
  ARRAY['麦乐鸡', '麦当劳麦乐鸡', 'mcnugget', 'mcnuggets'],
  '{"小": 0.75, "中": 1.0, "大": 1.35, "超大": 1.6}'::jsonb,
  '{"生": 1.0, "熟": 0.92, "煮": 1.0, "蒸": 0.95, "炒": 1.08, "炸": 0.9, "烤": 0.88, "炖": 1.1, "汤": 1.2}'::jsonb,
  NULL,
  0.96,
  'fitness_food_brand_safety',
  '按麦当劳中国 5 块麦乐鸡默认规格回填：5块≈80g，单块≈16g。',
  18
)
ON CONFLICT (normalized_name_zh) DO UPDATE
SET
  food_name_zh = EXCLUDED.food_name_zh,
  default_grams = EXCLUDED.default_grams,
  unit_grams = EXCLUDED.unit_grams,
  keyword_patterns = EXCLUDED.keyword_patterns,
  size_multipliers = EXCLUDED.size_multipliers,
  preparation_multipliers = EXCLUDED.preparation_multipliers,
  density_g_per_ml = EXCLUDED.density_g_per_ml,
  confidence_score = GREATEST(core.portion_reference.confidence_score, EXCLUDED.confidence_score),
  reference_source = EXCLUDED.reference_source,
  notes = EXCLUDED.notes,
  priority = LEAST(core.portion_reference.priority, EXCLUDED.priority),
  updated_at = NOW();

UPDATE core.portion_reference
SET
  priority = 95,
  notes = CONCAT_WS(
    ' ',
    NULLIF(notes, ''),
    '[runtime_lookup_brand_safety] 长名称冷冻餐 seed 已降权，避免污染鸡块类短词估重。'
  ),
  updated_at = NOW()
WHERE normalized_name_zh = '鸡肉饼或无骨裹面包屑鸡块、土豆、蔬菜冷冻餐'
  AND reference_source = 'fitness_food_bulk_seed';

SELECT app.bump_runtime_cache_state('lookup');
