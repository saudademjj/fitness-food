-- Repeatable runtime lookup risk report.
-- `observed_lookup_miss_count` uses app.lookup_miss_telemetry as the only
-- currently persisted per-name frequency signal; resolved-but-bad rows may show 0.

WITH strict_catalog_candidates AS (
  SELECT
    COALESCE(NULLIF(ac.food_name_zh, ''), NULLIF(ac.food_name_en, ''), '(unknown)') AS food_name,
    regexp_replace(
      lower(COALESCE(NULLIF(ac.food_name_zh, ''), NULLIF(ac.food_name_en, ''), '')),
      '\s+',
      '',
      'g'
    ) AS normalized_food_name,
    ac.source_system,
    ac.source_item_id,
    ac.source_category,
    ac.source_subcategory,
    COALESCE(ac.energy_kcal, 0) AS energy_kcal,
    COALESCE(ac.protein_grams, 0) AS protein_grams,
    COALESCE(ac.carbohydrate_grams, 0) AS carbohydrate_grams,
    COALESCE(ac.fat_grams, 0) AS fat_grams,
    COALESCE(ac.sugars_grams, 0) AS sugars_grams,
    (
      COALESCE(ac.protein_grams, 0) * 4
      + COALESCE(ac.carbohydrate_grams, 0) * 4
      + COALESCE(ac.fat_grams, 0) * 9
    ) AS expected_kcal
  FROM core.app_catalog_profile_23 ac
  WHERE ac.publish_ready = TRUE
    AND COALESCE(ac.energy_kcal_is_present, FALSE) = TRUE
    AND COALESCE(ac.protein_grams_is_present, FALSE) = TRUE
    AND COALESCE(ac.carbohydrate_grams_is_present, FALSE) = TRUE
    AND COALESCE(ac.fat_grams_is_present, FALSE) = TRUE
    AND (
      COALESCE(ac.food_name_zh, '') ~ '[一-龥]'
      OR EXISTS (
        SELECT 1
        FROM app.lookup_miss_telemetry miss
        WHERE miss.normalized_food_name = regexp_replace(
          lower(COALESCE(NULLIF(ac.food_name_zh, ''), NULLIF(ac.food_name_en, ''), '')),
          '\s+',
          '',
          'g'
        )
          AND miss.occurrence_count >= 2
      )
    )
    AND (
      COALESCE(ac.food_name_zh, '') ~ '(可口可乐|可乐|雪碧|芬达|汽水|苏打|气泡水|奶茶|果汁|咖啡|拿铁|美式|乌龙|麦乐鸡|鸡块|薯条|汉堡|披萨|三明治|卷饼|蛋糕|蛋挞|炒饭|盖饭|米饭|面条|拉面|拌面|粥|包子|馒头|饺子|汤圆)'
      OR COALESCE(ac.food_name_en, '') ~* '(cola|soda|sprite|fanta|latte|coffee|tea|juice|mcnugget|nugget|fries|burger|pizza|sandwich|burrito|cake|tart|rice|noodle|dumpling)'
      OR COALESCE(ac.source_category, '') ~* '(beverage|drink|dessert|snack|prepared|fast food)'
      OR (
        ac.source_system = 'open_food_facts'
        AND COALESCE(ac.food_name_zh, '') ~ '[一-龥]'
      )
    )
    AND COALESCE(ac.food_name_zh, '') !~ '(伏特加|威士忌|朗姆酒|白兰地|龙舌兰|金酒|蒸馏酒|酒精饮料|代糖|甜味剂|甜菊|甜叶菊|罗汉果)'
    AND COALESCE(ac.food_name_en, '') !~* '(vodka|whiskey|rum|brandy|tequila|gin|sweetener|sucralose|stevia|erythritol)'
    AND COALESCE(ac.food_name_zh, '') !~ '(无糖|零度|低卡)'
),
catalog_risks AS (
  SELECT
    'catalog'::text AS risk_scope,
    'thermodynamic_mismatch'::text AS risk_type,
    source_system,
    food_name,
    normalized_food_name,
    source_item_id,
    format(
      'kcal=%s expected_kcal=%s protein=%s carb=%s fat=%s',
      trim(to_char(energy_kcal, 'FM999999990.00')),
      trim(to_char(expected_kcal, 'FM999999990.0')),
      trim(to_char(protein_grams, 'FM999999990.00')),
      trim(to_char(carbohydrate_grams, 'FM999999990.00')),
      trim(to_char(fat_grams, 'FM999999990.00'))
    ) AS evidence
  FROM strict_catalog_candidates
  WHERE abs(energy_kcal - expected_kcal) > GREATEST(18, expected_kcal * 0.28)

  UNION ALL

  SELECT
    'catalog'::text,
    'sugars_exceed_carbohydrate'::text,
    source_system,
    food_name,
    normalized_food_name,
    source_item_id,
    format(
      'sugars=%s carb=%s',
      trim(to_char(sugars_grams, 'FM999999990.00')),
      trim(to_char(carbohydrate_grams, 'FM999999990.00'))
    ) AS evidence
  FROM strict_catalog_candidates
  WHERE sugars_grams > carbohydrate_grams + 0.01

  UNION ALL

  SELECT
    'catalog'::text,
    'sweetened_beverage_kcal_probably_kj'::text,
    source_system,
    food_name,
    normalized_food_name,
    source_item_id,
    format(
      'kcal=%s expected_kcal=%s expected_kj=%s carb=%s',
      trim(to_char(energy_kcal, 'FM999999990.00')),
      trim(to_char(expected_kcal, 'FM999999990.0')),
      trim(to_char(expected_kcal * 4.184, 'FM999999990.0')),
      trim(to_char(carbohydrate_grams, 'FM999999990.00'))
    ) AS evidence
  FROM strict_catalog_candidates
  WHERE food_name ~ '(可口可乐|可乐|雪碧|芬达|汽水|苏打|气泡水|果汁|奶茶|咖啡|茶|cola|sprite|fanta|juice|latte|tea|coffee)'
    AND carbohydrate_grams BETWEEN 5 AND 20
    AND abs(energy_kcal - (expected_kcal * 4.184)) <= GREATEST(14, expected_kcal * 0.32)
    AND abs(energy_kcal - expected_kcal) >= 35
),
portion_keyword_risks AS (
  SELECT
    'portion_reference'::text AS risk_scope,
    'keyword_overreach'::text AS risk_type,
    'portion_reference'::text AS source_system,
    pr.food_name_zh AS food_name,
    pr.normalized_name_zh AS normalized_food_name,
    NULL::text AS source_item_id,
    format(
      'keyword=%s priority=%s ref=%s',
      keyword.keyword,
      pr.priority,
      pr.reference_source
    ) AS evidence
  FROM core.portion_reference pr
  JOIN LATERAL unnest(pr.keyword_patterns) keyword(keyword) ON TRUE
  WHERE regexp_replace(lower(keyword.keyword), '\s+', '', 'g') IN ('粉', '面', '饭', '饼', '汤', '羹', '粥')
     OR char_length(regexp_replace(lower(keyword.keyword), '\s+', '', 'g')) <= 1
),
portion_seed_risks AS (
  SELECT
    'portion_reference'::text AS risk_scope,
    'long_name_seed_overreach'::text AS risk_type,
    'portion_reference'::text AS source_system,
    pr.food_name_zh AS food_name,
    pr.normalized_name_zh AS normalized_food_name,
    NULL::text AS source_item_id,
    format(
      'default_grams=%s unit_grams=%s ref=%s priority=%s',
      trim(to_char(pr.default_grams, 'FM999999990.00')),
      COALESCE(pr.unit_grams::text, '{}'),
      pr.reference_source,
      pr.priority
    ) AS evidence
  FROM core.portion_reference pr
  WHERE pr.reference_source = 'fitness_food_bulk_seed'
    AND char_length(regexp_replace(lower(pr.normalized_name_zh), '\s+', '', 'g')) >= 12
    AND (
      pr.default_grams >= 180
      OR COALESCE((pr.unit_grams ->> '块')::numeric, 0) >= 80
      OR COALESCE((pr.unit_grams ->> '个')::numeric, 0) >= 160
    )
),
all_risks AS (
  SELECT * FROM catalog_risks
  UNION ALL
  SELECT * FROM portion_keyword_risks
  UNION ALL
  SELECT * FROM portion_seed_risks
)
SELECT
  risk_scope,
  risk_type,
  source_system,
  food_name AS food_name_zh,
  all_risks.normalized_food_name,
  COALESCE(miss.occurrence_count, 0) AS observed_lookup_miss_count,
  COUNT(*)::int AS candidate_count,
  array_to_string(array_remove(array_agg(DISTINCT source_item_id), NULL), ' | ') AS source_item_ids,
  array_to_string(array_agg(DISTINCT evidence), ' | ') AS evidence_samples
FROM all_risks
LEFT JOIN app.lookup_miss_telemetry miss
  ON miss.normalized_food_name = all_risks.normalized_food_name
GROUP BY
  risk_scope,
  risk_type,
  source_system,
  food_name,
  all_risks.normalized_food_name,
  miss.occurrence_count
ORDER BY
  observed_lookup_miss_count DESC,
  candidate_count DESC,
  risk_scope ASC,
  risk_type ASC,
  food_name_zh ASC;
