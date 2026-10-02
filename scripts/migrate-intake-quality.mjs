import { createRequire } from "node:module";
const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV === "production") {
  throw new Error("Development workspace only");
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(`BEGIN;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS trade_intake_answers text;
    ALTER TABLE retell_call_records ADD COLUMN IF NOT EXISTS name_captured boolean;
    ALTER TABLE retell_call_records ADD COLUMN IF NOT EXISTS callback_captured boolean;
    ALTER TABLE retell_call_records ADD COLUMN IF NOT EXISTS issue_captured boolean;
    ALTER TABLE retell_call_records ADD COLUMN IF NOT EXISTS address_captured boolean;
    ALTER TABLE retell_call_records ADD COLUMN IF NOT EXISTS analysis_complete boolean NOT NULL DEFAULT false;
    COMMIT;`);
  console.log("Development-only additive intake/quality migration completed.");
} finally { await pool.end(); }