import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV === "production") {
  throw new Error("Development workspace only. No production changes are authorized.");
}
const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(await readFile(new URL("./migrate-email-health.sql", import.meta.url), "utf8"));
  console.log("Development email health storage added. No messages requeued or sent.");
} finally { await pool.end(); }
