import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// Session locks must not occupy every query connection while their holders wait
// for queries on that same pool. Keep a small, separate pool for long-lived locks.
export const advisoryLockPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  allowExitOnIdle: true,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
