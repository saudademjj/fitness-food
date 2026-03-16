SELECT
  miss.normalized_food_name,
  miss.latest_raw_food_name,
  miss.occurrence_count,
  miss.last_seen_at,
  COALESCE(unpublished.candidate_count, 0) AS unpublished_candidate_count
FROM app.lookup_miss_telemetry miss
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS candidate_count
  FROM core.app_catalog_profile_23 ac
  WHERE ac.publish_ready = FALSE
    AND regexp_replace(lower(COALESCE(ac.food_name_zh, '')), '\s+', '', 'g') = miss.normalized_food_name
) unpublished ON TRUE
ORDER BY miss.occurrence_count DESC, miss.last_seen_at DESC;
