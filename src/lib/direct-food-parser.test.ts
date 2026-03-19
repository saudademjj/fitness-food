import assert from 'node:assert/strict';
import test from 'node:test';
import {config} from 'dotenv';

import {getDbPool} from '@/lib/db';
import {tryResolveDirectDescription} from '@/lib/direct-food-parser';
import {databaseTest} from '@/lib/test-database';

config({path: '.env.local'});

test.after(async () => {
  await getDbPool().end().catch(() => undefined);
  global.__fitnessFoodDbPool = undefined;
});

databaseTest('tryResolveDirectDescription keeps 300ml 可口可乐 near 127 kcal', async () => {
  const result = await tryResolveDirectDescription('300ml可口可乐');

  assert.ok(result);
  assert.equal(result?.length, 1);
  assert.equal(result?.[0]?.estimatedGrams, 300);
  assert.ok(
    (result?.[0]?.totals.energyKcal ?? 0) >= 126 &&
      (result?.[0]?.totals.energyKcal ?? 0) <= 129
  );
});

databaseTest('tryResolveDirectDescription keeps 5块 麦乐鸡 near 80g and 213 kcal', async () => {
  const result = await tryResolveDirectDescription('5块麦乐鸡');

  assert.ok(result);
  assert.equal(result?.length, 1);
  assert.equal(result?.[0]?.estimatedGrams, 80);
  assert.ok(
    (result?.[0]?.totals.energyKcal ?? 0) >= 212 &&
      (result?.[0]?.totals.energyKcal ?? 0) <= 225
  );
  assert.ok(result?.[0]?.validationFlags.includes('brand_curated_override'));
});
