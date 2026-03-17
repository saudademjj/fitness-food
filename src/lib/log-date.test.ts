import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTimestampForDateKey,
  formatLocalDateKey,
  getDateKeyFromTimestamp,
} from '@/lib/log-date';

test('buildTimestampForDateKey applies the selected day while preserving the time of day', () => {
  const reference = new Date(2026, 2, 17, 21, 45, 30, 123);
  const timestamp = buildTimestampForDateKey('2026-03-05', reference);
  const result = new Date(timestamp);

  assert.equal(formatLocalDateKey(result), '2026-03-05');
  assert.equal(result.getHours(), 21);
  assert.equal(result.getMinutes(), 45);
  assert.equal(result.getSeconds(), 30);
  assert.equal(result.getMilliseconds(), 123);
});

test('buildTimestampForDateKey falls back to the reference timestamp for invalid dates', () => {
  const reference = new Date(2026, 2, 17, 9, 8, 7, 6);

  assert.equal(
    buildTimestampForDateKey('not-a-date', reference),
    reference.getTime()
  );
});

test('getDateKeyFromTimestamp uses the local calendar date', () => {
  const localDate = new Date(2026, 0, 5, 1, 2, 3, 4);

  assert.equal(getDateKeyFromTimestamp(localDate.getTime()), '2026-01-05');
});
