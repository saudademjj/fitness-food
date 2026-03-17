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
