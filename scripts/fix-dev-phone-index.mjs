import { createRequire } from "node:module";
const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");

if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV === "production") {
  throw new Error("Development workspace only");
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  // Holds the table lock through index replacement; failure restores the original index.
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS retell_phone_normalized text
    GENERATED ALWAYS AS (NULLIF(regexp_replace(retell_phone_number, '[^0-9]', '', 'g'), '')) STORED`);
  const { rows } = await client.query(`SELECT indexdef FROM pg_indexes
    WHERE schemaname='public' AND indexname='businesses_phone_normalized_unique'`);
  if (rows.length && !rows[0].indexdef.endsWith("(retell_phone_normalized)")) {
    // The user approved replacement of this one development-only index.
    await client.query("DROP INDEX public.businesses_phone_normalized_unique");
  }
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS businesses_phone_normalized_unique
    ON public.businesses (retell_phone_normalized)`);
  await client.query("COMMIT");
  console.log("Development normalized-phone column and column-only unique index verified.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}