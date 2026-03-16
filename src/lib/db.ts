import {Pool, types} from 'pg';

types.setTypeParser(1700, (value) => Number.parseFloat(value));

declare global {
  // eslint-disable-next-line no-var
  var __fitnessFoodDbPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __fitnessFoodDbPoolCleanupRegistered: boolean | undefined;
}

function isTestProcess(): boolean {
  return process.argv.includes('--test');
}

function registerTestPoolCleanup(): void {
  if (!isTestProcess() || global.__fitnessFoodDbPoolCleanupRegistered) {
    return;
  }

  global.__fitnessFoodDbPoolCleanupRegistered = true;
  process.once('beforeExit', async () => {
    try {
      await global.__fitnessFoodDbPool?.end();
    } catch {
      // Ignore cleanup errors in test shutdown.
    }
  });
}

function createPool(): Pool {
  const poolConfig = {
    max: process.env.PGPOOL_MAX ? Number.parseInt(process.env.PGPOOL_MAX, 10) : 20,
    min: process.env.PGPOOL_MIN ? Number.parseInt(process.env.PGPOOL_MIN, 10) : 2,
    idleTimeoutMillis: process.env.PG_IDLE_TIMEOUT_MS
      ? Number.parseInt(process.env.PG_IDLE_TIMEOUT_MS, 10)
      : 30_000,
    connectionTimeoutMillis: process.env.PG_CONNECTION_TIMEOUT_MS
      ? Number.parseInt(process.env.PG_CONNECTION_TIMEOUT_MS, 10)
      : 5_000,
    statement_timeout: process.env.PG_STATEMENT_TIMEOUT_MS
      ? Number.parseInt(process.env.PG_STATEMENT_TIMEOUT_MS, 10)
      : 8_000,
    allowExitOnIdle: isTestProcess(),
  };

  if (process.env.DATABASE_URL) {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      ...poolConfig,
    });
  }

  return new Pool({
    database: process.env.PGDATABASE ?? 'foodetl_local',
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number.parseInt(process.env.PGPORT, 10) : undefined,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ...poolConfig,
  });
}

export function getDbPool(): Pool {
  registerTestPoolCleanup();
  if (!global.__fitnessFoodDbPool) {
    global.__fitnessFoodDbPool = createPool();
  }

  return global.__fitnessFoodDbPool;
}
