import assert from 'node:assert/strict';
import test from 'node:test';
import {config} from 'dotenv';

import {getDbPool} from '@/lib/db';
import {
  isSafeFuzzyCandidate,
  lookupNutritionByNameExact,
  lookupNutritionByNameFuzzy,
  mapRowToLookupResult,
  type CatalogRow,
} from '@/lib/nutrition-db';

config({path: '.env.local'});

function createCatalogRow(overrides: Partial<CatalogRow>): CatalogRow {
  return {
    entity_type: 'food',
    food_name_zh: '测试食物',
    food_name_en: null,
    source_system: 'unit-test',
    energy_kcal: 0,
    protein_grams: 0,
    carbohydrate_grams: 0,
    fat_grams: 0,
    fiber_grams: 0,
    sugars_grams: 0,
    sodium_mg: 0,
    potassium_mg: 0,
    calcium_mg: 0,
    magnesium_mg: 0,
    iron_mg: 0,
    zinc_mg: 0,
    vitamin_a_mcg: 0,
    vitamin_c_mg: 0,
    vitamin_d_mcg: 0,
    vitamin_e_mg: 0,
    vitamin_k_mcg: 0,
    thiamin_mg: 0,
    riboflavin_mg: 0,
    niacin_mg: 0,
    vitamin_b6_mg: 0,
    vitamin_b12_mcg: 0,
    folate_mcg: 0,
    energy_kcal_is_present: true,
    protein_grams_is_present: true,
    carbohydrate_grams_is_present: true,
    fat_grams_is_present: true,
    fiber_grams_is_present: true,
    sugars_grams_is_present: true,
    sodium_mg_is_present: true,
    potassium_mg_is_present: true,
    calcium_mg_is_present: true,
    magnesium_mg_is_present: true,
    iron_mg_is_present: true,
    zinc_mg_is_present: true,
    vitamin_a_mcg_is_present: true,
    vitamin_c_mg_is_present: true,
    vitamin_d_mcg_is_present: true,
    vitamin_e_mg_is_present: true,
    vitamin_k_mcg_is_present: true,
    thiamin_mg_is_present: true,
    riboflavin_mg_is_present: true,
    niacin_mg_is_present: true,
    vitamin_b6_mg_is_present: true,
    vitamin_b12_mcg_is_present: true,
    folate_mcg_is_present: true,
    amount_basis_g: 100,
    publish_ready: true,
    completeness_ratio: 1,
    macro_present_count: 4,
    non_core_present_count: 19,
    measured_nutrient_count: 23,
    ...overrides,
  } as CatalogRow;
}

test('mapRowToLookupResult normalizes non-100g rows to per-100g values', () => {
  const row = createCatalogRow({
    energy_kcal: 240,
    protein_grams: 20,
    carbohydrate_grams: 10,
    fat_grams: 8,
    amount_basis_g: 200,
    sodium_mg: 300,
  });

  const result = mapRowToLookupResult(row, 'exact');

  assert.equal(result.amountBasisG, 200);
  assert.equal(result.per100g.energyKcal, 120);
  assert.equal(result.per100g.proteinGrams, 10);
  assert.equal(result.per100g.carbohydrateGrams, 5);
  assert.equal(result.per100g.fatGrams, 4);
  assert.equal(result.per100g.sodiumMg, 150);
});

test('mapRowToLookupResult preserves missing micronutrients as null instead of zero', () => {
  const row = createCatalogRow({
    vitamin_d_mcg: null,
    vitamin_d_mcg_is_present: false,
  });

  const result = mapRowToLookupResult(row, 'exact');

  assert.equal(result.per100g.vitaminDMcg, null);
  assert.equal(result.per100gMeta.vitaminDMcg.status, 'missing');
  assert.ok(result.validationFlags.includes('db_micronutrient_gap'));
});

test('isSafeFuzzyCandidate rejects dangerous category suffixes', () => {
  const row = createCatalogRow({
    food_name_zh: '羊肉串调味料',
    fuzzy_score: 0.91,
  });

  assert.equal(isSafeFuzzyCandidate('羊肉串', row), false);
});

test('isSafeFuzzyCandidate rejects short two-character mismatches to specific cuts', () => {
  const row = createCatalogRow({
    food_name_zh: '鸡翅',
    fuzzy_score: 0.9,
  });

  assert.equal(isSafeFuzzyCandidate('鸡', row), false);
  assert.equal(isSafeFuzzyCandidate('鸡肉', row), false);
});

const hasDatabase = Boolean(process.env.DATABASE_URL);
const databaseTest = hasDatabase ? test : test.skip;

test.after(async () => {
  await getDbPool().end().catch(() => undefined);
  global.__fitnessFoodDbPool = undefined;
});

databaseTest('lookupNutritionByNameFuzzy keeps short generic names on-target when fuzzy matching is enabled', async () => {
  const [apple, rice, egg] = await Promise.all([
    lookupNutritionByNameFuzzy('苹果'),
    lookupNutritionByNameFuzzy('米饭'),
    lookupNutritionByNameFuzzy('鸡蛋'),
  ]);

  if (apple) {
    assert.equal(apple.matchedName, '生苹果');
  }
  if (rice) {
    assert.equal(rice.matchedName, '米饭，熟，未进一步说明');
  }
  if (egg) {
    assert.equal(egg.matchedName, '鸡蛋，全蛋，熟制，烹饪方法未说明');
  }
});

databaseTest('lookupNutritionByNameFuzzy does not collapse composite dishes to a single ingredient', async () => {
  const result = await lookupNutritionByNameFuzzy('火腿蛋炒饭');
  assert.notEqual(result?.matchedName, '火腿');
});

databaseTest('lookupNutritionByNameExact allows preview rows for exact alias hits with complete macros', async () => {
  const result = await lookupNutritionByNameExact('豆浆');

  if (result) {
    assert.equal(result.matchedName, '豆浆');
    assert.equal(result.matchMode, 'exact');
  }
});

databaseTest('lookupNutritionByNameExact resolves protein powder through the seeded alias', async () => {
  const result = await lookupNutritionByNameExact('蛋白粉');

  assert.ok(result);
  assert.equal(result?.sourceKind, 'catalog');
  assert.equal(result?.matchMode, 'exact');
  assert.ok((result?.per100g.proteinGrams ?? 0) >= 70);
});

databaseTest('lookupNutritionByNameExact resolves 麦旋风 through the seeded Chinese alias', async () => {
  const result = await lookupNutritionByNameExact('麦旋风');

  assert.ok(result);
  assert.equal(result?.sourceKind, 'catalog');
  assert.equal(result?.matchMode, 'exact');
  assert.ok(
    (result?.matchedName ?? '').includes('麦旋风') ||
      (result?.matchedName ?? '').toLowerCase().includes('mcflurry')
  );
});
