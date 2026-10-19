import { createRequire } from "node:module";
if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV === "production")
  throw new Error("Development workspace only.");
const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='businesses_internal_billing_check') THEN
        ALTER TABLE businesses ADD CONSTRAINT businesses_internal_billing_check CHECK
          (NOT is_internal OR (chosen_plan IS NULL AND billing_mode='manual' AND manual_payment_state IS NULL
            AND first_invoice_paid_at IS NULL AND NOT is_sample));
      END IF;
    END $$;`);
  console.log("Development internal-business schema ready. No messages sent.");
} finally { await pool.end(); }
