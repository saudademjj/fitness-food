import {getDbPool} from '@/lib/db';
import {normalizeLookupText} from '@/lib/food-text';

export async function recordLookupMiss(foodName: string): Promise<void> {
  const normalizedFoodName = normalizeLookupText(foodName);
  if (!normalizedFoodName) {
    return;
  }

  try {
    const pool = getDbPool();
    await pool.query(
      `
        INSERT INTO app.lookup_miss_telemetry (
          normalized_food_name,
          latest_raw_food_name,
          occurrence_count,
          last_seen_at
        )
        VALUES ($1, $2, 1, NOW())
        ON CONFLICT (normalized_food_name)
        DO UPDATE SET
          latest_raw_food_name = EXCLUDED.latest_raw_food_name,
          occurrence_count = app.lookup_miss_telemetry.occurrence_count + 1,
          last_seen_at = NOW()
      `,
      [normalizedFoodName, foodName]
    );
  } catch {
    // Telemetry must never block parsing.
  }
}
