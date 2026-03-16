import assert from 'node:assert/strict';
import test from 'node:test';
import {config} from 'dotenv';

import {getDbPool} from '@/lib/db';
import {
  isSafeFuzzyCandidate,
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
    amount_basis_g: 100,
    publish_ready: true,
    completeness_ratio: 1,
    ...overrides,
  };
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
    assert.equal(apple.matchedName, '苹果');
  }
  if (rice) {
    assert.equal(rice.matchedName, '米饭');
  }
  if (egg) {
    assert.equal(egg.matchedName, '鸡蛋');
  }
});

databaseTest('lookupNutritionByNameFuzzy does not collapse composite dishes to a single ingredient', async () => {
  const result = await lookupNutritionByNameFuzzy('火腿蛋炒饭');
  assert.notEqual(result?.matchedName, '火腿');
});
