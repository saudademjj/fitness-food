import type {ParseFoodDescriptionOutput, ValidationFlag} from '@/lib/food-contract';
import {getDbPool} from '@/lib/db';
import {
  CORE_MACRO_KEYS,
  NUTRITION_PROFILE_KEYS,
  createNutritionProfile,
  pickMacroNutrients,
  type NutritionProfile23,
} from '@/lib/nutrition-profile';
import type {FoodLogEntry} from '@/components/macro-calculator/types';

type FoodLogItemRow = {
  item_id: string;
  food_log_id: string;
  eaten_at: Date;
  source_description: string | null;
  food_name: string;
  quantity_description: string;
  estimated_grams: number;
  confidence: number;
  source_kind: 'recipe' | 'catalog' | 'ai_fallback';
  source_label: string;
  match_mode: 'exact' | 'fuzzy' | 'ai_fallback';
  source_status: 'published' | 'preview';
  amount_basis_g: number;
  validation_flags: string[] | null;
  per100g_profile: NutritionProfile23 | null;
  totals_profile: NutritionProfile23 | null;
  energy_kcal: number;
  protein_grams: number;
  carbohydrate_grams: number;
  fat_grams: number;
  total_energy_kcal: number;
  total_protein_grams: number;
  total_carbohydrate_grams: number;
  total_fat_grams: number;
};

type ExportFormat = 'csv' | 'json';

function normalizeStoredProfile(
  profile: unknown,
  legacyValues: Partial<NutritionProfile23>
): NutritionProfile23 {
  if (profile && typeof profile === 'object') {
    return createNutritionProfile(profile as Partial<NutritionProfile23>);
  }

  return createNutritionProfile(legacyValues);
}

function mapRowToEntry(row: FoodLogItemRow): FoodLogEntry {
  const validationFlags = Array.isArray(row.validation_flags)
    ? (row.validation_flags as ValidationFlag[])
    : [];
  const per100g = normalizeStoredProfile(row.per100g_profile, {
    energyKcal: Number(row.energy_kcal),
    proteinGrams: Number(row.protein_grams),
    carbohydrateGrams: Number(row.carbohydrate_grams),
    fatGrams: Number(row.fat_grams),
  });
  const totals = normalizeStoredProfile(row.totals_profile, {
    energyKcal: Number(row.total_energy_kcal),
    proteinGrams: Number(row.total_protein_grams),
    carbohydrateGrams: Number(row.total_carbohydrate_grams),
    fatGrams: Number(row.total_fat_grams),
  });

  return {
    id: row.item_id,
    foodLogId: row.food_log_id,
    timestamp: row.eaten_at.getTime(),
    foodName: row.food_name,
    quantityDescription: row.quantity_description,
    estimatedGrams: Number(row.estimated_grams),
    confidence: Number(row.confidence),
    sourceKind: row.source_kind,
    sourceLabel: row.source_label,
    matchMode: row.match_mode,
    sourceStatus: row.source_status,
    amountBasisG: Number(row.amount_basis_g),
    validationFlags,
    per100g,
    totals,
  };
}

function buildLegacyCoreValues(profile: NutritionProfile23) {
  const macros = pickMacroNutrients(profile);
  return CORE_MACRO_KEYS.map((key) => macros[key]);
}

const RETURNING_COLUMNS = `
  id AS item_id,
  $1::uuid AS food_log_id,
  $2::timestamptz AS eaten_at,
  $3::text AS source_description,
  food_name,
  quantity_description,
  estimated_grams,
  confidence,
  source_kind,
  source_label,
  match_mode,
  source_status,
  amount_basis_g,
  validation_flags,
  per100g_profile,
  totals_profile,
  energy_kcal,
  protein_grams,
  carbohydrate_grams,
  fat_grams,
  total_energy_kcal,
  total_protein_grams,
  total_carbohydrate_grams,
  total_fat_grams
`;

export async function listFoodLogEntries(userId: string, date?: string): Promise<FoodLogEntry[]> {
  const pool = getDbPool();
  const params: unknown[] = [userId];
  const dateFilter = date
    ? (() => {
        params.push(date);
        return 'AND fl.eaten_on = $2::date';
      })()
    : '';

  const result = await pool.query<FoodLogItemRow>(
    `
      SELECT
        item.id AS item_id,
        fl.id AS food_log_id,
        fl.eaten_at,
        fl.source_description,
        item.food_name,
        item.quantity_description,
        item.estimated_grams,
        item.confidence,
        item.source_kind,
        item.source_label,
        item.match_mode,
        item.source_status,
        item.amount_basis_g,
        item.validation_flags,
        item.per100g_profile,
        item.totals_profile,
        item.energy_kcal,
        item.protein_grams,
        item.carbohydrate_grams,
        item.fat_grams,
        item.total_energy_kcal,
        item.total_protein_grams,
        item.total_carbohydrate_grams,
        item.total_fat_grams
      FROM app.food_log fl
      JOIN app.food_log_item item ON item.food_log_id = fl.id
      WHERE fl.user_id = $1
        ${dateFilter}
      ORDER BY fl.eaten_at DESC, item.created_at DESC
    `,
    params
  );

  return result.rows.map(mapRowToEntry);
}

export async function createFoodLog(
  userId: string,
  foods: ParseFoodDescriptionOutput,
  sourceDescription?: string | null,
  eatenAt?: number
): Promise<FoodLogEntry[]> {
  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const eatenDate = eatenAt ? new Date(eatenAt) : new Date();
    const logResult = await client.query<{id: string}>(
      `
        INSERT INTO app.food_log (user_id, source_description, eaten_at, eaten_on)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      [userId, sourceDescription ?? null, eatenDate, eatenDate.toISOString().slice(0, 10)]
    );

    const foodLogId = logResult.rows[0]!.id;
    const createdEntries: FoodLogEntry[] = [];

    for (const food of foods) {
      const [energyKcal, proteinGrams, carbohydrateGrams, fatGrams] = buildLegacyCoreValues(
        food.per100g
      );
      const [totalEnergy, totalProtein, totalCarbohydrate, totalFat] = buildLegacyCoreValues(
        food.totals
      );

      const itemResult = await client.query<FoodLogItemRow>(
        `
          INSERT INTO app.food_log_item (
            food_log_id,
            food_name,
            quantity_description,
            estimated_grams,
            confidence,
            source_kind,
            source_label,
            match_mode,
            source_status,
            amount_basis_g,
            validation_flags,
            per100g_profile,
            totals_profile,
            energy_kcal,
            protein_grams,
            carbohydrate_grams,
            fat_grams,
            total_energy_kcal,
            total_protein_grams,
            total_carbohydrate_grams,
            total_fat_grams
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, $16, $17, $18, $19, $20, $21
          )
          RETURNING
            id AS item_id,
            $1::uuid AS food_log_id,
            $22::timestamptz AS eaten_at,
            $23::text AS source_description,
            food_name,
            quantity_description,
            estimated_grams,
            confidence,
            source_kind,
            source_label,
            match_mode,
            source_status,
            amount_basis_g,
            validation_flags,
            per100g_profile,
            totals_profile,
            energy_kcal,
            protein_grams,
            carbohydrate_grams,
            fat_grams,
            total_energy_kcal,
            total_protein_grams,
            total_carbohydrate_grams,
            total_fat_grams
        `,
        [
          foodLogId,
          food.foodName,
          food.quantityDescription,
          food.estimatedGrams,
          food.confidence,
          food.sourceKind,
          food.sourceLabel,
          food.matchMode,
          food.sourceStatus,
          food.amountBasisG,
          JSON.stringify(food.validationFlags),
          JSON.stringify(food.per100g),
          JSON.stringify(food.totals),
          energyKcal,
          proteinGrams,
          carbohydrateGrams,
          fatGrams,
          totalEnergy,
          totalProtein,
          totalCarbohydrate,
          totalFat,
          eatenDate,
          sourceDescription ?? null,
        ]
      );

      createdEntries.push(mapRowToEntry(itemResult.rows[0]!));
    }

    await client.query('COMMIT');
    return createdEntries;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateFoodLogItem(
  userId: string,
  itemId: string,
  food: ParseFoodDescriptionOutput[number]
): Promise<FoodLogEntry> {
  const pool = getDbPool();
  const [energyKcal, proteinGrams, carbohydrateGrams, fatGrams] = buildLegacyCoreValues(
    food.per100g
  );
  const [totalEnergy, totalProtein, totalCarbohydrate, totalFat] = buildLegacyCoreValues(
    food.totals
  );
  const result = await pool.query<FoodLogItemRow>(
    `
      UPDATE app.food_log_item item
      SET
        food_name = $3,
        quantity_description = $4,
        estimated_grams = $5,
        confidence = $6,
        source_kind = $7,
        source_label = $8,
        match_mode = $9,
        source_status = $10,
        amount_basis_g = $11,
        validation_flags = $12::jsonb,
        per100g_profile = $13::jsonb,
        totals_profile = $14::jsonb,
        energy_kcal = $15,
        protein_grams = $16,
        carbohydrate_grams = $17,
        fat_grams = $18,
        total_energy_kcal = $19,
        total_protein_grams = $20,
        total_carbohydrate_grams = $21,
        total_fat_grams = $22,
        updated_at = NOW()
      FROM app.food_log fl
      WHERE item.id = $1
        AND fl.id = item.food_log_id
        AND fl.user_id = $2
      RETURNING
        item.id AS item_id,
        fl.id AS food_log_id,
        fl.eaten_at,
        fl.source_description,
        item.food_name,
        item.quantity_description,
        item.estimated_grams,
        item.confidence,
        item.source_kind,
        item.source_label,
        item.match_mode,
        item.source_status,
        item.amount_basis_g,
        item.validation_flags,
        item.per100g_profile,
        item.totals_profile,
        item.energy_kcal,
        item.protein_grams,
        item.carbohydrate_grams,
        item.fat_grams,
        item.total_energy_kcal,
        item.total_protein_grams,
        item.total_carbohydrate_grams,
        item.total_fat_grams
    `,
    [
      itemId,
      userId,
      food.foodName,
      food.quantityDescription,
      food.estimatedGrams,
      food.confidence,
      food.sourceKind,
      food.sourceLabel,
      food.matchMode,
      food.sourceStatus,
      food.amountBasisG,
      JSON.stringify(food.validationFlags),
      JSON.stringify(food.per100g),
      JSON.stringify(food.totals),
      energyKcal,
      proteinGrams,
      carbohydrateGrams,
      fatGrams,
      totalEnergy,
      totalProtein,
      totalCarbohydrate,
      totalFat,
    ]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('未找到要更新的食物记录。');
  }

  return mapRowToEntry(row);
}

export async function deleteFoodLogItem(userId: string, itemId: string): Promise<void> {
  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const deleteResult = await client.query<{food_log_id: string}>(
      `
        DELETE FROM app.food_log_item item
        USING app.food_log fl
        WHERE item.id = $1
          AND fl.id = item.food_log_id
          AND fl.user_id = $2
        RETURNING item.food_log_id
      `,
      [itemId, userId]
    );

    const foodLogId = deleteResult.rows[0]?.food_log_id;
    if (!foodLogId) {
      throw new Error('未找到要删除的食物记录。');
    }

    await client.query(
      `
        DELETE FROM app.food_log fl
        WHERE fl.id = $1
          AND NOT EXISTS (
            SELECT 1
            FROM app.food_log_item item
            WHERE item.food_log_id = fl.id
          )
      `,
      [foodLogId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function exportFoodLogs(
  userId: string,
  format: ExportFormat,
  date?: string
): Promise<{filename: string; mimeType: string; content: string}> {
  const entries = await listFoodLogEntries(userId, date);
  const suffix = date ? `-${date}` : '';

  if (format === 'json') {
    return {
      filename: `fitness-food-export${suffix}.json`,
      mimeType: 'application/json',
      content: JSON.stringify(entries, null, 2),
    };
  }

  const header = [
    'id',
    'foodLogId',
    'timestamp',
    'foodName',
    'quantityDescription',
    'estimatedGrams',
    'sourceKind',
    'sourceLabel',
    'matchMode',
    'amountBasisG',
    ...NUTRITION_PROFILE_KEYS.map((key) => `per100g.${key}`),
    ...NUTRITION_PROFILE_KEYS.map((key) => `totals.${key}`),
    'validationFlags',
  ];
  const lines = [header.join(',')];
  for (const entry of entries) {
    const row = [
      entry.id,
      entry.foodLogId ?? '',
      String(entry.timestamp),
      entry.foodName,
      entry.quantityDescription,
      String(entry.estimatedGrams),
      entry.sourceKind,
      entry.sourceLabel,
      entry.matchMode,
      String(entry.amountBasisG),
      ...NUTRITION_PROFILE_KEYS.map((key) => String(entry.per100g[key])),
      ...NUTRITION_PROFILE_KEYS.map((key) => String(entry.totals[key])),
      entry.validationFlags.join('|'),
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`);
    lines.push(row.join(','));
  }

  return {
    filename: `fitness-food-export${suffix}.csv`,
    mimeType: 'text/csv;charset=utf-8',
    content: lines.join('\n'),
  };
}

export async function migrateLocalDraftEntries(
  userId: string,
  entries: FoodLogEntry[]
): Promise<number> {
  const grouped = new Map<string, FoodLogEntry[]>();
  for (const entry of entries) {
    const key = entry.draftBatchId ?? `legacy:${entry.id}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(entry);
    grouped.set(key, bucket);
  }

  let migrated = 0;
  for (const group of grouped.values()) {
    const foods: ParseFoodDescriptionOutput = group.map((entry) => ({
      foodName: entry.foodName,
      quantityDescription: entry.quantityDescription,
      estimatedGrams: entry.estimatedGrams,
      confidence: entry.confidence,
      sourceKind: entry.sourceKind,
      sourceLabel: entry.sourceLabel,
      matchMode: entry.matchMode,
      sourceStatus: entry.sourceStatus,
      amountBasisG: entry.amountBasisG,
      validationFlags: entry.validationFlags,
      per100g: entry.per100g,
      totals: entry.totals,
    }));
    const eatenAt = Math.min(...group.map((entry) => entry.timestamp));
    await createFoodLog(userId, foods, 'Migrated from local storage', eatenAt);
    migrated += group.length;
  }

  return migrated;
}
