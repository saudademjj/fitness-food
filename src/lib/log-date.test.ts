import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTimestampForDateKey,
  formatLocalDateKey,
  getChineseDayOfWeek,
  getDateKeyFromTimestamp,
  getRelativeDateLabel,
  getTodayDateKey,
  shiftDateKey,
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

test('getTodayDateKey returns the current local date', () => {
  const result = getTodayDateKey();
  assert.equal(result, formatLocalDateKey(new Date()));
});

test('shiftDateKey moves forward by N days', () => {
  assert.equal(shiftDateKey('2026-03-15', 1), '2026-03-16');
  assert.equal(shiftDateKey('2026-03-15', 3), '2026-03-18');
});

test('shiftDateKey moves backward by N days', () => {
  assert.equal(shiftDateKey('2026-03-15', -1), '2026-03-14');
  assert.equal(shiftDateKey('2026-03-01', -1), '2026-02-28');
});

test('shiftDateKey crosses month boundaries', () => {
  assert.equal(shiftDateKey('2026-01-31', 1), '2026-02-01');
  assert.equal(shiftDateKey('2026-12-31', 1), '2027-01-01');
});

test('shiftDateKey returns the same key for invalid input', () => {
  assert.equal(shiftDateKey('not-a-date', 1), 'not-a-date');
});

test('getChineseDayOfWeek returns correct Chinese day name', () => {
  // 2026-03-16 is a Monday
  assert.equal(getChineseDayOfWeek('2026-03-16'), '周一');
  // 2026-03-21 is a Saturday
  assert.equal(getChineseDayOfWeek('2026-03-21'), '周六');
  // 2026-03-22 is a Sunday
  assert.equal(getChineseDayOfWeek('2026-03-22'), '周日');
});

test('getChineseDayOfWeek returns empty string for invalid input', () => {
  assert.equal(getChineseDayOfWeek('invalid'), '');
});

test('getRelativeDateLabel returns 今日 for today', () => {
  assert.equal(getRelativeDateLabel('2026-03-15', '2026-03-15'), '今日');
});

test('getRelativeDateLabel returns 昨日 for yesterday', () => {
  assert.equal(getRelativeDateLabel('2026-03-14', '2026-03-15'), '昨日');
});

test('getRelativeDateLabel returns 前天 for day before yesterday', () => {
  assert.equal(getRelativeDateLabel('2026-03-13', '2026-03-15'), '前天');
});

test('getRelativeDateLabel returns null for other dates', () => {
  assert.equal(getRelativeDateLabel('2026-03-12', '2026-03-15'), null);
  assert.equal(getRelativeDateLabel('2026-03-16', '2026-03-15'), null);
});
