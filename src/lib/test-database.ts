import test, {type TestContext} from 'node:test';

import {getDbPool} from '@/lib/db';

let databaseAvailabilityPromise: Promise<boolean> | null = null;

async function isDatabaseAvailable(): Promise<boolean> {
  if (!databaseAvailabilityPromise) {
    databaseAvailabilityPromise = (async () => {
      const hasConnectionConfig = Boolean(
        process.env.DATABASE_URL || process.env.PGHOST || process.env.PGDATABASE
      );
      if (!hasConnectionConfig) {
        return false;
      }

      try {
        await getDbPool().query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    })();
  }

  return databaseAvailabilityPromise;
}

export function databaseTest(
  name: string,
  fn: (t: TestContext) => Promise<void> | void
): void {
  test(name, async (t) => {
    if (!(await isDatabaseAvailable())) {
      t.skip('PostgreSQL is not reachable for database-backed tests.');
      return;
    }

    await fn(t);
  });
}
