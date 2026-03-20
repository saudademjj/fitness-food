const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateKey(value: string): boolean {
  return DATE_KEY_PATTERN.test(value);
}

export function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDateKeyFromTimestamp(timestamp: number): string {
  return formatLocalDateKey(new Date(timestamp));
}

export function getTodayDateKey(): string {
  return formatLocalDateKey(new Date());
}

export function shiftDateKey(dateKey: string, days: number): string {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) {
    return dateKey;
  }

  const date = new Date(
    Number.parseInt(match[1]!, 10),
    Number.parseInt(match[2]!, 10) - 1,
    Number.parseInt(match[3]!, 10)
  );
  date.setDate(date.getDate() + days);
  return formatLocalDateKey(date);
}

const CHINESE_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

export function getChineseDayOfWeek(dateKey: string): string {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) {
    return '';
  }

  const date = new Date(
    Number.parseInt(match[1]!, 10),
    Number.parseInt(match[2]!, 10) - 1,
    Number.parseInt(match[3]!, 10)
  );
  return CHINESE_DAYS[date.getDay()]!;
}

export function getRelativeDateLabel(dateKey: string, todayKey: string): string | null {
  if (dateKey === todayKey) {
    return '今日';
  }

  const yesterday = shiftDateKey(todayKey, -1);
  if (dateKey === yesterday) {
    return '昨日';
  }

  const dayBefore = shiftDateKey(todayKey, -2);
  if (dateKey === dayBefore) {
    return '前天';
  }

  return null;
}

export function buildTimestampForDateKey(
  dateKey: string,
  referenceDate: Date = new Date()
): number {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) {
    return referenceDate.getTime();
  }

  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const day = Number.parseInt(match[3]!, 10);

  return new Date(
    year,
    month - 1,
    day,
    referenceDate.getHours(),
    referenceDate.getMinutes(),
    referenceDate.getSeconds(),
    referenceDate.getMilliseconds()
  ).getTime();
}
