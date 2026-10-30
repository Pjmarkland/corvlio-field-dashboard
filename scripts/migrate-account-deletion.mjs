import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV === "production") {
  throw new Error("Development workspace only. Production migration requires separate approval.");
}
const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(await readFile(new URL("./migrate-account-deletion.sql", import.meta.url), "utf8"));
  console.log("Development-only account deletion schema applied. Invoice history remains intact.");
} finally { await pool.end(); }
