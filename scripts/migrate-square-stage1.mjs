import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV === "production") {
  throw new Error("Development workspace only. No production migration is authorized.");
}
const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(await readFile(new URL("./migrate-square-stage1.sql", import.meta.url), "utf8"));
  console.log("Development billing-mode flag added. Existing businesses remain manual.");
} finally { await pool.end(); }
