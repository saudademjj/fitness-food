import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NUTRIENT_GROUPS,
  NUTRITION_PROFILE_KEYS,
  createNutritionProfile,
} from '@/lib/nutrition-profile';
import {
  getNutritionCategory,
  sanitizeFallbackNutritionProfile,
  validateMacroNutrients,
} from '@/lib/validation';

test('validateMacroNutrients accepts thermodynamically consistent values', () => {
  const issues = validateMacroNutrients(createNutritionProfile({
    energyKcal: 250,
    proteinGrams: 10,
    carbohydrateGrams: 20,
    fatGrams: 14.4,
    fiberGrams: 3,
    sugarsGrams: 8,
  }), 0.12, '火腿蛋炒饭');

  assert.deepEqual(issues, []);
});

test('validateMacroNutrients rejects implausible AI fallback macros', () => {
  const issues = validateMacroNutrients(createNutritionProfile({
    energyKcal: 980,
    proteinGrams: 15,
    carbohydrateGrams: 20,
    fatGrams: 10,
    sugarsGrams: 40,
  }), 0.12, '可乐');

  assert.ok(issues.includes('energy_out_of_range'));
  assert.ok(issues.includes('thermodynamic_mismatch'));
  assert.ok(issues.includes('sugars_exceed_carbohydrate'));
});

test('sanitizeFallbackNutritionProfile conservatively clamps invalid AI estimates', () => {
  const sanitized = sanitizeFallbackNutritionProfile(
    '炸鸡翅',
    createNutritionProfile({
      energyKcal: 5,
      proteinGrams: 120,
      carbohydrateGrams: 2,
      fatGrams: 90,
      sugarsGrams: 5,
      sodiumMg: 8000,
    })
  );

  assert.equal(sanitized.adjusted, true);
  assert.ok(sanitized.issues.length > 0);
  assert.ok((sanitized.profile.energyKcal ?? 0) > 0);
  assert.ok((sanitized.profile.proteinGrams ?? 0) <= 45);
  assert.ok((sanitized.profile.sodiumMg ?? 0) <= 4000);
});

test('sanitizeFallbackNutritionProfile clamps micronutrients into category-specific ranges', () => {
  const sanitized = sanitizeFallbackNutritionProfile(
    '可乐',
    createNutritionProfile({
      energyKcal: 80,
      proteinGrams: 0,
      carbohydrateGrams: 18,
      fatGrams: 0,
      fiberGrams: 12,
      sodiumMg: 1200,
      calciumMg: 800,
      ironMg: 6,
    })
  );

  assert.equal(sanitized.adjusted, true);
  assert.ok((sanitized.profile.fiberGrams ?? 0) <= 2);
  assert.ok((sanitized.profile.sodiumMg ?? 0) <= 220);
  assert.ok((sanitized.profile.calciumMg ?? 0) <= 260);
  assert.ok((sanitized.profile.ironMg ?? 0) <= 1.2);
});

test('sanitizeFallbackNutritionProfile suppresses impossible vitamin values for vegetables', () => {
  const sanitized = sanitizeFallbackNutritionProfile(
    '西兰花',
    createNutritionProfile({
      energyKcal: 35,
      proteinGrams: 3,
      carbohydrateGrams: 5,
      fatGrams: 0.4,
      potassiumMg: 20,
      vitaminCMg: 0,
      vitaminB12Mcg: 50,
      folateMcg: 2,
    })
  );

  assert.equal(sanitized.adjusted, true);
  assert.ok((sanitized.profile.potassiumMg ?? 0) >= 80);
  assert.ok((sanitized.profile.vitaminCMg ?? 0) >= 2);
  assert.ok((sanitized.profile.vitaminB12Mcg ?? 0) <= 0.1);
  assert.ok((sanitized.profile.folateMcg ?? 0) >= 8);
});

test('getNutritionCategory prefers mixed dishes when staple and protein cues coexist', () => {
  assert.equal(getNutritionCategory('鸡肉炒饭'), 'mixed_dish');
  assert.equal(getNutritionCategory('番茄鸡蛋面'), 'mixed_dish');
});

test('NUTRIENT_GROUPS covers every nutrition field exactly once', () => {
  const groupedKeys = NUTRIENT_GROUPS.flatMap((group) => group.fields.map((field) => field.key)).sort();
  const expectedKeys = [...NUTRITION_PROFILE_KEYS].sort();

  assert.deepEqual(groupedKeys, expectedKeys);
});
