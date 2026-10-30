import { createRequire } from "node:module";
const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV === "production") {
  throw new Error("Development workspace only");
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(`BEGIN;
    ALTER TABLE businesses ADD COLUMN IF NOT EXISTS owner_phone text;
    ALTER TABLE businesses ADD COLUMN IF NOT EXISTS lead_alerts_enabled boolean NOT NULL DEFAULT true;
    CREATE TABLE IF NOT EXISTS owner_demo_calls (
      id uuid PRIMARY KEY, business_id integer NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      confirmed_number text NOT NULL, call_id text UNIQUE, status text NOT NULL DEFAULT 'reserved',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS read_at timestamptz;
    ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'skipped';
    ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0;
    ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS email_next_attempt_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS email_last_error text;
    COMMIT;`);
  console.log("Development-only additive migration completed.");
} finally { await pool.end(); }