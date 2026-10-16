import type pg from "pg";
import { databaseErrorFields } from "./errors";

/** One pair per API process. Kept injectable so limits/error handling can be tested without a DB. */
export function createDatabasePools(Pool: typeof pg.Pool, connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 8,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  });
  // Session-lock holders must not consume the query pool they depend on.
  const advisoryLockPool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    // Limits blocking acquisition SQL, not a held session lock's lifetime.
    statement_timeout: 15_000,
    allowExitOnIdle: true,
  });
  for (const [name, clientPool] of [["query", pool], ["advisory", advisoryLockPool]] as const) {
    // pg otherwise throws an unhandled error when an idle client disconnects.
    clientPool.on("error", error => {
      process.emitWarning(JSON.stringify({ pool: name, ...databaseErrorFields(error) }), {
        code: "DATABASE_POOL_ERROR",
      });
    });
  }
  return { pool, advisoryLockPool };
}
