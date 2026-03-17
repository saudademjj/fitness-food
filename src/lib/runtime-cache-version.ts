import {getDbPool} from '@/lib/db';

declare global {
  // eslint-disable-next-line no-var
  var __fitnessFoodRuntimeCacheVersion:
    | Map<string, {expiresAt: number; value: Promise<string>}>
    | undefined;
}

const RUNTIME_CACHE_VERSION_TTL_MS = 30_000;

function getRuntimeVersionCache() {
  if (!global.__fitnessFoodRuntimeCacheVersion) {
    global.__fitnessFoodRuntimeCacheVersion = new Map();
  }

  return global.__fitnessFoodRuntimeCacheVersion;
}

export async function getRuntimeLookupVersion(scope = 'lookup'): Promise<string> {
  const cache = getRuntimeVersionCache();
  const now = Date.now();
  const cached = cache.get(scope);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = (async () => {
    try {
      const pool = getDbPool();
      const result = await pool.query<{version: string}>(
        `
          SELECT version::text
          FROM app.runtime_cache_state
          WHERE scope = $1
          LIMIT 1
        `,
        [scope]
      );
      return result.rows[0]?.version ?? '0';
    } catch {
      return '0';
    }
  })();

  cache.set(scope, {
    expiresAt: now + RUNTIME_CACHE_VERSION_TTL_MS,
    value,
  });

  return value;
}
