import assert from 'node:assert/strict';
import test from 'node:test';

import {resolveDescriptionSegment} from '@/ai/flows/parse-food-description-flow';
import type {NutritionLookupResolver, NutritionLookupResult} from '@/lib/nutrition-db';
import {buildNutritionProfileMeta, createNutritionProfile} from '@/lib/nutrition-profile';

function makeLookupResult(foodName: string): NutritionLookupResult {
  const per100g = createNutritionProfile({
    energyKcal: foodName === '米饭' ? 116 : 122,
    proteinGrams: foodName === '米饭' ? 2.6 : 12.6,
    carbohydrateGrams: foodName === '米饭' ? 25.9 : 4,
    fatGrams: foodName === '米饭' ? 0.3 : 6.2,
  });

  return {
    sourceKind: 'catalog',
    sourceLabel: `测试营养库 · ${foodName}`,
    matchedName: foodName,
    entityId: null,
    entitySlug: null,
    sourceItemId: null,
    foodGroup: null,
    sourceCategory: 'test',
    sourceSubcategory: null,
    per100g,
    per100gMeta: buildNutritionProfileMeta(per100g, {
      knownStatus: 'measured',
      knownSource: 'database',
      missingSource: 'database',
    }),
    amountBasisG: 100,
    matchMode: 'exact',
    sourceStatus: 'published',
    validationFlags: [],
    measuredNutrientCount: 4,
    missingFieldKeys: [],
  };
}

function createLookupResolver(): NutritionLookupResolver {
  return async (foodName) => {
    if (foodName === '辣椒炒肉' || foodName === '米饭') {
      return makeLookupResult(foodName);
    }

    return null;
  };
}

test('resolveDescriptionSegment keeps combo meals as direct top-level foods', async () => {
  const result = await resolveDescriptionSegment('辣椒炒肉配米饭', createLookupResolver());

  assert.equal(result.segment.resolutionKind, 'direct_items');
  assert.deepEqual(
    result.segment.items.map((item) => item.foodName),
    ['辣椒炒肉', '米饭']
  );
  assert.equal(result.segment.ingredientBreakdown.length, 0);
});

test('resolveDescriptionSegment does not collapse shared-quantity combo meals into one aggregate item', async () => {
  const result = await resolveDescriptionSegment('一份辣椒炒肉配米饭', createLookupResolver());

  assert.equal(result.segment.resolutionKind, 'direct_items');
  assert.deepEqual(
    result.segment.items.map((item) => ({
      foodName: item.foodName,
      quantityDescription: item.quantityDescription,
    })),
    [
      {foodName: '辣椒炒肉', quantityDescription: '一份'},
      {foodName: '米饭', quantityDescription: '未知'},
    ]
  );
  assert.equal(result.segment.items.length, 2);
  assert.ok(result.segment.totalWeight > 180);
});
