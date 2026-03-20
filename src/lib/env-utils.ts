export function readStringEnv(names: string | string[]): string | undefined {
  for (const name of Array.isArray(names) ? names : [names]) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function readBooleanEnv(
  names: string | string[],
  fallback = false
): boolean {
  for (const name of Array.isArray(names) ? names : [names]) {
    const raw = process.env[name]?.trim().toLowerCase();
    if (!raw) {
      continue;
    }

    if (['1', 'true', 'yes', 'on'].includes(raw)) {
      return true;
    }

    if (['0', 'false', 'no', 'off'].includes(raw)) {
      return false;
    }
  }

  return fallback;
}

export function readPositiveIntegerEnv(names: string | string[]): number | undefined;
export function readPositiveIntegerEnv(
  names: string | string[],
  fallback: number
): number;
export function readPositiveIntegerEnv(
  names: string | string[],
  fallback?: number
): number | undefined {
  for (const name of Array.isArray(names) ? names : [names]) {
    const raw = process.env[name]?.trim();
    if (!raw) {
      continue;
    }

    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallback;
}
