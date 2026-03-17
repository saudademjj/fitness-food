import assert from 'node:assert/strict';
import test from 'node:test';
import {config} from 'dotenv';

import {getDbPool} from '@/lib/db';
import {buildNutritionProfileMeta, createNutritionProfile} from '@/lib/nutrition-profile';
import {
  applyPreparationNutritionAdjustments,
  estimateGrams,
} from '@/lib/portion-reference';

config({path: '.env.local'});

const hasDatabase = Boolean(process.env.DATABASE_URL);

const databaseTest = hasDatabase ? test : test.skip;

test.after(async () => {
  await getDbPool().end().catch(() => undefined);
  global.__fitnessFoodDbPool = undefined;
});

test('applyPreparationNutritionAdjustments raises fat for fried foods matched to plain ingredients', () => {
  const base = createNutritionProfile({
    energyKcal: 140,
    proteinGrams: 18,
    carbohydrateGrams: 2,
    fatGrams: 7,
    sodiumMg: 90,
  });
  const baseMeta = buildNutritionProfileMeta(base, {
    knownStatus: 'measured',
    knownSource: 'database',
  });

  const adjusted = applyPreparationNutritionAdjustments(base, baseMeta, '炸鸡翅', '鸡翅');

  assert.ok((adjusted.profile.fatGrams ?? 0) > (base.fatGrams ?? 0));
  assert.ok((adjusted.profile.energyKcal ?? 0) > (base.energyKcal ?? 0));
  assert.ok((adjusted.profile.sodiumMg ?? 0) >= (base.sodiumMg ?? 0));
});

databaseTest('estimateGrams uses seeded portion references for common foods', async () => {
  const cases = [
    {foodName: '苹果', quantity: '一个', expectedGrams: 220, expectedFlag: 'portion_reference_applied'},
    {foodName: '排骨汤', quantity: '一碗', expectedGrams: 450, expectedFlag: 'portion_reference_applied'},
    {foodName: '披萨', quantity: '一份', expectedGrams: 320, expectedFlag: 'portion_reference_applied'},
    {foodName: '蛋糕', quantity: '一块', expectedGrams: 90, expectedFlag: 'portion_reference_applied'},
    {foodName: '米饭', quantity: '一碗', expectedGrams: 180, expectedFlag: 'portion_reference_applied'},
    {foodName: '鸡蛋', quantity: '一个', expectedGrams: 50, expectedFlag: 'portion_reference_applied'},
  ] as const;

  for (const item of cases) {
    const result = await estimateGrams(item.foodName, item.quantity);
    assert.equal(result.grams, item.expectedGrams);
    assert.ok(result.validationFlags.includes(item.expectedFlag));
  }
});

databaseTest('estimateGrams falls back to keyword-based portion matching for skew-prone foods', async () => {
  const result = await estimateGrams('羊肉串', '一串');
  assert.equal(result.grams, 35);
  assert.ok(result.validationFlags.includes('portion_keyword_applied'));
});

databaseTest('estimateGrams applies size and preparation multipliers', async () => {
  const steamedMantou = await estimateGrams('大馒头', '一个');
  assert.ok(steamedMantou.grams >= 130);
  assert.ok(steamedMantou.validationFlags.includes('portion_size_adjusted'));

  const friedWing = await estimateGrams('炸鸡翅', '一个');
  assert.ok(friedWing.validationFlags.includes('portion_preparation_adjusted'));
});

databaseTest('estimateGrams uses generic heuristic fallback for unseen foods', async () => {
  const result = await estimateGrams('神秘气泡饮料', '一杯');
  assert.equal(result.grams, 330);
  assert.ok(result.validationFlags.includes('portion_fallback_applied'));
  assert.equal(result.portion?.sourceLabel, '应用内通用回退估算');
});
