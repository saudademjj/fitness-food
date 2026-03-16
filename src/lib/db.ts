import {Pool, types} from 'pg';

types.setTypeParser(1700, (value) => Number.parseFloat(value));

declare global {
  // eslint-disable-next-line no-var
  var __fitnessFoodDbPool: Pool | undefined;
}

function createPool(): Pool {
  if (process.env.DATABASE_URL) {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }

  return new Pool({
    database: process.env.PGDATABASE ?? 'foodetl_local',
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number.parseInt(process.env.PGPORT, 10) : undefined,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  });
}

export function getDbPool(): Pool {
  if (!global.__fitnessFoodDbPool) {
    global.__fitnessFoodDbPool = createPool();
  }

  return global.__fitnessFoodDbPool;
}
