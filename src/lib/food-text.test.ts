import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractMultiFoodCandidates,
  normalizeItemSeparators,
  sanitizeFoodName,
  splitFoodDescriptionSegments,
} from '@/lib/food-text';

test('splitFoodDescriptionSegments keeps natural connectors as item boundaries', () => {
  const segments = splitFoodDescriptionSegments('两个包子和一杯豆浆');
  assert.deepEqual(segments, ['两个包子', '一杯豆浆']);
});

test('extractMultiFoodCandidates parses connector-joined foods', () => {
  const candidates = extractMultiFoodCandidates('两个包子和一杯豆浆');
  assert.deepEqual(candidates, [
    {foodName: '包子', quantityDescription: '两个'},
    {foodName: '豆浆', quantityDescription: '一杯'},
  ]);
});

test('splitFoodDescriptionSegments preserves explicit metric weights per segment', () => {
  const segments = splitFoodDescriptionSegments('400g火腿蛋炒饭配300ml可乐');
  assert.deepEqual(segments, ['400g火腿蛋炒饭', '300ml可乐']);
});

test('normalizeItemSeparators preserves food names that contain 和 intrinsically', () => {
  assert.equal(normalizeItemSeparators('牛肉和洋葱汤'), '牛肉和洋葱汤');
  assert.equal(normalizeItemSeparators('和牛汉堡'), '和牛汉堡');
});

test('sanitizeFoodName keeps intrinsic leading 和 for food names such as 和牛', () => {
  assert.equal(sanitizeFoodName('和牛汉堡'), '和牛汉堡');
});
