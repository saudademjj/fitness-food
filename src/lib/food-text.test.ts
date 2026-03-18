import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractMultiFoodCandidates,
  isCompositeFoodName,
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

test('extractMultiFoodCandidates also splits foods without explicit quantity phrases', () => {
  const candidates = extractMultiFoodCandidates('包子和豆浆');
  assert.deepEqual(candidates, [
    {foodName: '包子', quantityDescription: '未知'},
    {foodName: '豆浆', quantityDescription: '未知'},
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

test('normalizeItemSeparators can split pairing connectors when quantity appears later in the clause', () => {
  assert.deepEqual(splitFoodDescriptionSegments('烤鸡翅搭配薯条和一杯可乐'), [
    '烤鸡翅',
    '薯条',
    '一杯可乐',
  ]);
});

test('splitFoodDescriptionSegments keeps intrinsic 和 inside composite dish names', () => {
  assert.deepEqual(splitFoodDescriptionSegments('牛肉和洋葱炒饭配一杯可乐'), [
    '牛肉和洋葱炒饭',
    '一杯可乐',
  ]);
});

test('sanitizeFoodName keeps intrinsic leading 和 for food names such as 和牛', () => {
  assert.equal(sanitizeFoodName('和牛汉堡'), '和牛汉堡');
});

test('isCompositeFoodName avoids obvious non-food verb compounds', () => {
  assert.equal(isCompositeFoodName('炒勺'), false);
  assert.equal(isCompositeFoodName('炒作'), false);
  assert.equal(isCompositeFoodName('辣椒炒肉'), true);
});
