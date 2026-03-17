UPDATE core.canonical_food cf
SET publish_ready = TRUE
FROM core.app_food_profile_23 afp
WHERE cf.id = afp.canonical_food_id
  AND cf.publish_ready = FALSE
  AND COALESCE(afp.energy_kcal_is_present, FALSE) = TRUE
  AND COALESCE(afp.protein_grams_is_present, FALSE) = TRUE
  AND COALESCE(afp.carbohydrate_grams_is_present, FALSE) = TRUE
  AND COALESCE(afp.fat_grams_is_present, FALSE) = TRUE;

UPDATE core.canonical_food cf
SET display_name_zh = updates.display_name_zh
FROM (
  VALUES
    ('4e6d9d0c-59ba-414a-bedd-5cc872c0433d'::uuid, '麦旋风（奥利奥）'),
    ('83bfc8d8-a04d-4331-93e9-52e8fa9dcbbd'::uuid, '麦旋风（M&M豆）')
) AS updates(id, display_name_zh)
WHERE cf.id = updates.id
  AND COALESCE(NULLIF(cf.display_name_zh, ''), '') = '';

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
  seed.canonical_food_id,
  seed.alias_text,
  regexp_replace(lower(seed.alias_text), '\s+', '', 'g'),
  'zh',
  'seeded_runtime_alias',
  'fitness_food_runtime_lookup_repair',
  seed.confidence
FROM (
  VALUES
    ('54914712-e11d-4586-ad72-2d983c7444bd'::uuid, '蛋白粉', 0.96),
    ('54914712-e11d-4586-ad72-2d983c7444bd'::uuid, '乳清蛋白粉', 0.99),
    ('54914712-e11d-4586-ad72-2d983c7444bd'::uuid, 'whey protein', 0.90),
    ('4e6d9d0c-59ba-414a-bedd-5cc872c0433d'::uuid, '麦旋风', 0.95),
    ('4e6d9d0c-59ba-414a-bedd-5cc872c0433d'::uuid, '奥利奥麦旋风', 0.99),
    ('4e6d9d0c-59ba-414a-bedd-5cc872c0433d'::uuid, '麦旋风奥利奥', 0.97),
    ('83bfc8d8-a04d-4331-93e9-52e8fa9dcbbd'::uuid, 'M&M麦旋风', 0.97),
    ('83bfc8d8-a04d-4331-93e9-52e8fa9dcbbd'::uuid, '麦旋风M&M豆', 0.95)
) AS seed(canonical_food_id, alias_text, confidence)
ON CONFLICT (canonical_food_id, normalized_alias, language_code, provenance) DO NOTHING;

INSERT INTO core.portion_reference (
  food_name_zh,
  normalized_name_zh,
  default_grams,
  unit_grams,
  keyword_patterns,
  reference_source,
  notes,
  priority
)
VALUES
  (
    '蛋白粉',
    '蛋白粉',
    30,
    '{"份": 30, "勺": 30, "勺子": 30, "g": 1, "克": 1}'::jsonb,
    ARRAY['蛋白粉', '乳清蛋白粉', 'protein powder', 'whey protein'],
    'fitness_food_runtime_lookup_repair',
    '按常见一勺乳清蛋白粉估算',
    18
  ),
  (
    '麦旋风',
    '麦旋风',
    170,
    '{"个": 170, "份": 170, "杯": 170, "g": 1, "克": 1}'::jsonb,
    ARRAY['麦旋风', '奥利奥麦旋风', '麦旋风奥利奥', 'mcflurry'],
    'fitness_food_runtime_lookup_repair',
    '按常见单杯麦旋风估算',
    18
  )
ON CONFLICT (normalized_name_zh) DO UPDATE
SET
  food_name_zh = EXCLUDED.food_name_zh,
  default_grams = EXCLUDED.default_grams,
  unit_grams = EXCLUDED.unit_grams,
  keyword_patterns = EXCLUDED.keyword_patterns,
  reference_source = EXCLUDED.reference_source,
  notes = EXCLUDED.notes,
  priority = EXCLUDED.priority,
  updated_at = NOW();
