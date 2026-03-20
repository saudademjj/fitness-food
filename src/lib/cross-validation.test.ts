import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {crossValidate} from '@/lib/cross-validation';
import type {AiEstimationResult} from '@/lib/parallel-ai-estimator';
import {createNutritionProfile} from '@/lib/nutrition-profile';

function makeItem(
  foodName: string,
  grams: number,
  confidence: number,
  energyKcal: number,
  proteinGrams: number,
  carbohydrateGrams: number,
  fatGrams: number
) {
  return {
    foodName,
    quantityDescription: '未知',
    estimatedGrams: grams,
    confidence,
    fallbackPer100g: createNutritionProfile({
      energyKcal,
      proteinGrams,
      carbohydrateGrams,
      fatGrams,
    }),
    fallbackPer100gMeta: undefined as never,
    fallbackAdjusted: false,
    fallbackValidationIssues: [],
  };
}

describe('crossValidate', () => {
  it('returns degraded for 0 results', () => {
    const result = crossValidate([], [{provider: 'primary_model', error: 'timeout'}], 3);
    assert.equal(result.consensusLevel, 'degraded');
    assert.equal(result.items.length, 0);
    assert.equal(result.failedProviders.length, 1);
  });

  it('returns degraded for 1 result with capped confidence', () => {
    const results: AiEstimationResult[] = [
      {
        provider: 'primary_model',
        items: [makeItem('米饭', 180, 0.9, 130, 2.7, 28, 0.3)],
      },
    ];

    const result = crossValidate(results, [{provider: 'minimax', error: 'fail'}], 2);
    assert.equal(result.consensusLevel, 'degraded');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]!.foodName, '米饭');
    assert(result.items[0]!.confidence <= 0.6);
    assert.equal(result.items[0]!.scoring.overallScore, 0);
  });

  it('scores aligned items from 2 agreeing models', () => {
    const results: AiEstimationResult[] = [
      {
        provider: 'primary_model',
        items: [makeItem('米饭', 180, 0.9, 130, 2.7, 28, 0.3)],
      },
      {
        provider: 'minimax',
        items: [makeItem('白米饭', 185, 0.85, 128, 2.6, 27.5, 0.3)],
      },
    ];

    const result = crossValidate(results, [], 2);
    assert.notEqual(result.consensusLevel, 'degraded');
    assert.equal(result.items.length, 1);
    assert(result.items[0]!.scoring.overallScore > 0.5);
    assert.deepEqual(result.items[0]!.contributingProviders.sort(), ['minimax', 'primary_model']);
  });

  it('handles 3 models with high agreement', () => {
    const results: AiEstimationResult[] = [
      {
        provider: 'primary_model',
        items: [makeItem('鸡蛋', 50, 0.95, 155, 13, 1.1, 11)],
      },
      {
        provider: 'minimax',
        items: [makeItem('鸡蛋', 52, 0.9, 150, 12.5, 1.0, 10.5)],
      },
      {
        provider: 'deepseek',
        items: [makeItem('鸡蛋', 48, 0.92, 152, 12.8, 1.05, 10.8)],
      },
    ];

    const result = crossValidate(results, [], 3);
    assert.equal(result.items.length, 1);
    assert(result.averageScore >= 0.7, `expected high score, got ${result.averageScore}`);
    assert.equal(result.items[0]!.contributingProviders.length, 3);
    // Consensus weight should be median
    assert.equal(result.items[0]!.estimatedGrams, 50);
  });

  it('handles different item counts across models', () => {
    const results: AiEstimationResult[] = [
      {
        provider: 'primary_model',
        items: [
          makeItem('米饭', 180, 0.9, 130, 2.7, 28, 0.3),
          makeItem('鸡蛋', 50, 0.85, 155, 13, 1.1, 11),
        ],
      },
      {
        provider: 'minimax',
        items: [makeItem('白米饭', 180, 0.85, 128, 2.6, 27, 0.3)],
      },
    ];

    const result = crossValidate(results, [], 2);
    // Should produce 2 groups: one aligned (米饭/白米饭), one unmatched (鸡蛋)
    assert.equal(result.items.length, 2);
  });

  it('handles completely divergent items', () => {
    const results: AiEstimationResult[] = [
      {
        provider: 'primary_model',
        items: [makeItem('米饭', 180, 0.9, 130, 2.7, 28, 0.3)],
      },
      {
        provider: 'minimax',
        items: [makeItem('面条', 350, 0.8, 140, 5, 25, 1)],
      },
    ];

    const result = crossValidate(results, [], 2);
    // Names are too different, should produce separate items
    assert.equal(result.items.length, 2);
  });

  it('handles multi-food alignment with partial matches', () => {
    const results: AiEstimationResult[] = [
      {
        provider: 'primary_model',
        items: [
          makeItem('米饭', 180, 0.9, 130, 2.7, 28, 0.3),
          makeItem('番茄炒蛋', 200, 0.85, 90, 6, 5, 5),
        ],
      },
      {
        provider: 'minimax',
        items: [
          makeItem('白米饭', 175, 0.88, 128, 2.6, 27, 0.3),
          makeItem('番茄炒蛋', 210, 0.82, 88, 5.8, 4.8, 5.2),
        ],
      },
      {
        provider: 'deepseek',
        items: [
          makeItem('米饭', 182, 0.9, 131, 2.7, 28.2, 0.3),
          makeItem('番茄炒蛋', 195, 0.84, 92, 6.2, 5.1, 5.1),
        ],
      },
    ];

    const result = crossValidate(results, [], 3);
    assert.equal(result.items.length, 2);
    // Both items should have all 3 providers contributing
    for (const item of result.items) {
      assert.equal(item.contributingProviders.length, 3);
    }
  });

  it('creates separate groups for synonym Chinese food names with different characters', () => {
    // 番茄 and 西红柿 are synonyms but character bigrams differ significantly
    const results: AiEstimationResult[] = [
      {
        provider: 'primary_model',
        items: [makeItem('番茄炒蛋', 200, 0.85, 90, 6, 5, 5)],
      },
      {
        provider: 'minimax',
        items: [makeItem('西红柿炒蛋', 210, 0.82, 88, 5.8, 4.8, 5.2)],
      },
    ];

    const result = crossValidate(results, [], 2);
    // These won't align due to low character bigram overlap - expected behavior
    assert.equal(result.items.length, 2);
  });
});
