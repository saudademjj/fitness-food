import assert from 'node:assert/strict';
import test from 'node:test';

import type {AiReviewedFoodItem, ResolvedFoodItem} from '@/lib/food-contract';
import {buildParseOutputFromFoods, applySecondaryReviewToOutput} from '@/lib/secondary-review';
import {
  buildNutritionProfileMeta,
  createNutritionProfile,
  scaleNutritionProfile,
  type NutritionProfile23,
} from '@/lib/nutrition-profile';

function makeAiReviewProfile(overrides: Partial<NutritionProfile23>): NutritionProfile23 {
  return createNutritionProfile(overrides);
}

function makeItem(overrides: Partial<ResolvedFoodItem> = {}): ResolvedFoodItem {
  const per100g = createNutritionProfile({
    energyKcal: 120,
    proteinGrams: 8,
    carbohydrateGrams: 10,
    fatGrams: 5,
  });
  const per100gMeta = buildNutritionProfileMeta(per100g, {
    knownStatus: overrides.sourceKind === 'ai_fallback' ? 'estimated' : 'measured',
    knownSource: overrides.sourceKind === 'ai_fallback' ? 'ai' : 'database',
    missingSource: overrides.sourceKind === 'ai_fallback' ? 'ai' : 'database',
  });
  const estimatedGrams = overrides.estimatedGrams ?? 100;

  return {
    foodName: '测试食物',
    quantityDescription: '1份',
    estimatedGrams,
    confidence: 0.5,
    sourceKind: 'ai_fallback',
    sourceLabel: 'AI 宏量估算',
    matchMode: 'ai_fallback',
    sourceStatus: 'published',
    amountBasisG: 100,
    validationFlags: [],
    per100g,
    per100gMeta,
    totals: scaleNutritionProfile(per100g, estimatedGrams),
    totalsMeta: per100gMeta,
    ...overrides,
  };
}

function makeReviewedItem(
  item: ResolvedFoodItem,
  overrides: Partial<AiReviewedFoodItem> = {}
): AiReviewedFoodItem {
  return {
    index: 0,
    foodName: item.foodName,
    estimatedGrams: 180,
    confidence: 0.78,
    reason: '根据份量与营养中位值复核',
    reviewedPer100g: makeAiReviewProfile({
      energyKcal: 200,
      proteinGrams: 12,
      carbohydrateGrams: 18,
      fatGrams: 9,
      vitaminCMg: 15,
    }),
    ...overrides,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('secondary review replaces ai fallback weight and nutrition', async () => {
  const item = makeItem({
    foodName: '蛋炒饭',
    quantityDescription: '1份',
    estimatedGrams: 140,
  });
  const output = buildParseOutputFromFoods([item], '一份蛋炒饭');

  const reviewed = await applySecondaryReviewToOutput({
    sourceDescription: '一份蛋炒饭',
    output,
    lockExplicitMetricWeights: false,
    reviewers: [
      {
        provider: 'mock_a',
        review: async () => [makeReviewedItem(item)],
      },
      {
        provider: 'mock_b',
        review: async () => [makeReviewedItem(item)],
      },
    ],
  });

  assert.equal(reviewed.output.items[0]?.estimatedGrams, 180);
  assert.equal(reviewed.output.items[0]?.per100g.energyKcal, 200);
  assert.equal(reviewed.output.items[0]?.totals.energyKcal, 360);
  assert.ok(reviewed.output.items[0]?.validationFlags.includes('ai_secondary_reviewed'));
  assert.ok(reviewed.output.items[0]?.validationFlags.includes('ai_secondary_adjusted'));
  assert.equal(reviewed.output.items[0]?.reviewMeta?.voteCount, 2);
  assert.equal(reviewed.output.items[0]?.reviewMeta?.verdict, 'high');
  assert.equal(reviewed.output.secondaryReviewSummary?.voteCount, 2);
  assert.equal(reviewed.output.secondaryReviewSummary?.successfulReviewerCount, 2);
});

test('secondary review preserves measured database values and only fills missing nutrients', async () => {
  const per100g = createNutritionProfile({
    energyKcal: 52,
    proteinGrams: 0.3,
    carbohydrateGrams: 14,
    fatGrams: 0.2,
  });
  const item = makeItem({
    foodName: '苹果',
    sourceKind: 'catalog',
    matchMode: 'exact',
    sourceLabel: '标准营养库',
    confidence: 0.92,
    per100g,
    per100gMeta: buildNutritionProfileMeta(per100g, {
      knownStatus: 'measured',
      knownSource: 'database',
      missingSource: 'database',
    }),
    totals: scaleNutritionProfile(per100g, 100),
    totalsMeta: buildNutritionProfileMeta(per100g, {
      knownStatus: 'measured',
      knownSource: 'database',
      missingSource: 'database',
    }),
  });
  const output = buildParseOutputFromFoods([item], '一个苹果');

  const reviewed = await applySecondaryReviewToOutput({
    sourceDescription: '一个苹果',
    output,
    lockExplicitMetricWeights: false,
    reviewers: [
      {
        provider: 'mock_a',
        review: async () => [
          makeReviewedItem(item, {
            estimatedGrams: 160,
            reviewedPer100g: makeAiReviewProfile({
              energyKcal: 70,
              proteinGrams: 1,
              carbohydrateGrams: 20,
              fatGrams: 0.3,
              vitaminCMg: 25,
            }),
          }),
        ],
      },
      {
        provider: 'mock_b',
        review: async () => [
          makeReviewedItem(item, {
            estimatedGrams: 160,
            reviewedPer100g: makeAiReviewProfile({
              energyKcal: 70,
              proteinGrams: 1,
              carbohydrateGrams: 20,
              fatGrams: 0.3,
              vitaminCMg: 25,
            }),
          }),
        ],
      },
    ],
  });

  assert.equal(reviewed.output.items[0]?.per100g.energyKcal, 52);
  assert.equal(reviewed.output.items[0]?.per100g.vitaminCMg, 25);
  assert.equal(reviewed.output.items[0]?.per100gMeta.vitaminCMg.source, 'database+ai');
  assert.equal(reviewed.output.items[0]?.reviewMeta?.voteCount, 2);
});

test('secondary review locks explicit metric weights during initial parse review', async () => {
  const item = makeItem({
    foodName: '可乐',
    quantityDescription: '300g',
    estimatedGrams: 300,
  });
  const output = buildParseOutputFromFoods([item], '300g可乐');

  const reviewed = await applySecondaryReviewToOutput({
    sourceDescription: '300g可乐',
    output,
    lockExplicitMetricWeights: true,
    reviewers: [
      {
        provider: 'mock_a',
        review: async () => [makeReviewedItem(item, {estimatedGrams: 450})],
      },
      {
        provider: 'mock_b',
        review: async () => [makeReviewedItem(item, {estimatedGrams: 450})],
      },
    ],
  });

  assert.equal(reviewed.output.items[0]?.estimatedGrams, 300);
});

test('secondary review can re-adjust edited weights when explicit lock is disabled', async () => {
  const item = makeItem({
    foodName: '可乐',
    quantityDescription: '300g',
    estimatedGrams: 300,
  });
  const output = buildParseOutputFromFoods([item], '300g可乐');

  const reviewed = await applySecondaryReviewToOutput({
    sourceDescription: '300g可乐',
    output,
    lockExplicitMetricWeights: false,
    reviewers: [
      {
        provider: 'mock_a',
        review: async () => [makeReviewedItem(item, {estimatedGrams: 450})],
      },
      {
        provider: 'mock_b',
        review: async () => [makeReviewedItem(item, {estimatedGrams: 450})],
      },
    ],
  });

  assert.equal(reviewed.output.items[0]?.estimatedGrams, 450);
});

test('secondary review keeps original result when only one reviewer returns', async () => {
  const item = makeItem({
    foodName: '蛋炒饭',
    quantityDescription: '1份',
    estimatedGrams: 140,
  });
  const output = buildParseOutputFromFoods([item], '一份蛋炒饭');

  const reviewed = await applySecondaryReviewToOutput({
    sourceDescription: '一份蛋炒饭',
    output,
    lockExplicitMetricWeights: false,
    reviewers: [
      {
        provider: 'mock',
        review: async () => [makeReviewedItem(item)],
      },
    ],
  });

  assert.equal(reviewed.output.items[0]?.estimatedGrams, 140);
  assert.equal(reviewed.output.items[0]?.per100g.energyKcal, 120);
  assert.ok(reviewed.output.items[0]?.validationFlags.includes('ai_secondary_review_failed'));
  assert.equal(reviewed.output.items[0]?.reviewMeta?.verdict, 'failed');
  assert.equal(reviewed.output.items[0]?.reviewMeta?.successfulReviewerCount, 1);
  assert.equal(reviewed.output.secondaryReviewSummary?.succeeded, false);
});

test('secondary review falls back safely when reviewer returns incompatible items', async () => {
  const item = makeItem({
    foodName: '燕麦粥',
    quantityDescription: '1碗',
  });
  const output = buildParseOutputFromFoods([item], '一碗燕麦粥');

  const reviewed = await applySecondaryReviewToOutput({
    sourceDescription: '一碗燕麦粥',
    output,
    lockExplicitMetricWeights: false,
    reviewers: [
      {
        provider: 'mock',
        review: async () => [makeReviewedItem(item, {foodName: '白粥'})],
      },
    ],
  });

  assert.equal(reviewed.output.items[0]?.estimatedGrams, item.estimatedGrams);
  assert.ok(reviewed.output.items[0]?.validationFlags.includes('ai_secondary_review_failed'));
  assert.equal(reviewed.output.items[0]?.reviewMeta?.verdict, 'failed');
  assert.equal(reviewed.output.secondaryReviewSummary?.succeeded, false);
});

test('secondary review does not abort slow reviewers just because the outer timeout env is low', async () => {
  const originalTimeout = process.env.SECONDARY_REVIEW_TIMEOUT_MS;
  process.env.SECONDARY_REVIEW_TIMEOUT_MS = '10';

  try {
    const item = makeItem({
      foodName: '辣椒炒肉',
      quantityDescription: '1份',
      estimatedGrams: 180,
    });
    const output = buildParseOutputFromFoods([item], '一份辣椒炒肉');

    const reviewed = await applySecondaryReviewToOutput({
      sourceDescription: '一份辣椒炒肉',
      output,
      lockExplicitMetricWeights: false,
      reviewers: [
        {
          provider: 'mock_a',
          review: async () => {
            await sleep(30);
            return [makeReviewedItem(item, {estimatedGrams: 200})];
          },
        },
        {
          provider: 'mock_b',
          review: async () => {
            await sleep(30);
            return [makeReviewedItem(item, {estimatedGrams: 200})];
          },
        },
      ],
    });

    assert.equal(reviewed.output.items[0]?.estimatedGrams, 200);
    assert.equal(reviewed.output.secondaryReviewSummary?.succeeded, true);
  } finally {
    if (originalTimeout === undefined) {
      delete process.env.SECONDARY_REVIEW_TIMEOUT_MS;
    } else {
      process.env.SECONDARY_REVIEW_TIMEOUT_MS = originalTimeout;
    }
  }
});

test('secondary review exposes only sanitized failure reasons to the UI summary', async () => {
  const item = makeItem({
    foodName: '辣椒炒肉',
    quantityDescription: '1份',
    estimatedGrams: 180,
  });
  const output = buildParseOutputFromFoods([item], '一份辣椒炒肉');

  const reviewed = await applySecondaryReviewToOutput({
    sourceDescription: '一份辣椒炒肉',
    output,
    lockExplicitMetricWeights: false,
    reviewers: [
      {
        provider: 'minimax',
        review: async () => {
          throw new Error(
            'OpenRouter MiniMax request failed with 429: {"error":{"message":"Provider returned error"}}'
          );
        },
      },
      {
        provider: 'deepseek',
        review: async () => {
          throw new Error('deepseek review timed out after 20000ms.');
        },
      },
    ],
  });

  assert.equal(reviewed.output.secondaryReviewSummary?.succeeded, false);
  assert.equal(
    reviewed.output.secondaryReviewSummary?.failureReason,
    'MiniMax 速率限制； DeepSeek 超时'
  );
});
