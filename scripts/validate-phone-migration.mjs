// Offline production-schema comparison and transactional DEVELOPMENT-only validation.
// Input is catalog metadata, never production rows or a production connection string.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { generateDrizzleJson, generateMigration } from "../lib/db/node_modules/drizzle-kit/api.mjs";
import * as schema from "../lib/db/src/schema/index.ts";
const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV === "production") {
  throw new Error("Development workspace only");
}
const prod = JSON.parse(await readFile("/tmp/phone-migration-prod-schema.json", "utf8"));
const introspected = process.argv.includes("--introspected");
const current = introspected
  ? JSON.parse(await readFile("/tmp/phone-index-introspection/meta/0000_snapshot.json", "utf8"))
  : generateDrizzleJson(schema);
const baseline = structuredClone(current);
for (const [key, table] of Object.entries(baseline.tables)) {
  const columns = prod.columns.filter(c => c.table_name === table.name);
  if (!columns.length) { delete baseline.tables[key]; continue; }
  for (const name of Object.keys(table.columns)) {
    if (!columns.some(c => c.column_name === name)) delete table.columns[name];
  }
  for (const name of Object.keys(table.indexes)) {
    if (!prod.indexes.some(i => i.tablename === table.name && i.indexname === name)) delete table.indexes[name];
  }
  for (const name of Object.keys(table.foreignKeys)) {
    if (!prod.constraints.some(c => c.table_name === table.name && c.conname === name.slice(0, 63))) delete table.foreignKeys[name];
  }
}
const statements = await generateMigration(baseline, current);
assert(statements.length > 0);
assert(!statements.some(s => /\b(DROP|RENAME|TRUNCATE)\b|^\s*(DELETE|UPDATE)\b/i.test(s)), "Migration must be additive");
assert(statements.every(s => /^CREATE (TABLE|UNIQUE INDEX|INDEX)|^ALTER TABLE .+ ADD /i.test(s)), "Unexpected migration action");
const phoneIndex = statements.find(s => s.startsWith('CREATE UNIQUE INDEX "businesses_phone_normalized_unique"'));
assert(phoneIndex?.includes('("retell_phone_normalized"'));
assert(!phoneIndex.includes("regexp_replace"));
await writeFile(`/tmp/phone-migration-reviewed${introspected ? "-introspected" : ""}.sql`, statements.join("\n\n"));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const q = name => `"${name.replaceAll('"', '""')}"`;
try {
  const actual = await client.query(`SELECT table_name,column_name,data_type,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema='public'`);
  for (const c of prod.columns) {
    const d = actual.rows.find(d => d.table_name === c.table_name && d.column_name === c.column_name);
    assert(d, `Existing column disappeared: ${c.table_name}.${c.column_name}`);
    assert.equal(d.data_type, c.data_type); assert.equal(d.is_nullable, c.is_nullable);
    assert.equal(d.column_default, c.column_default);
  }
  await client.query("BEGIN");
  await client.query("CREATE SCHEMA phone_migration_validation");
  await client.query("SET LOCAL search_path = phone_migration_validation, public");
  // Copy structure only. No production data was fetched or copied.
  for (const c of prod.columns.filter(c => c.column_default?.startsWith("nextval("))) {
    const sequence = c.column_default.match(/nextval\('([^']+)'/)[1].replace(/^public\./, "");
    await client.query(`CREATE SEQUENCE ${q(sequence)}`);
  }
  for (const table of [...new Set(prod.columns.map(c => c.table_name))]) {
    const cols = prod.columns.filter(c => c.table_name === table).map(c =>
      `${q(c.column_name)} ${c.data_type}${c.column_default ? ` DEFAULT ${c.column_default}` : ""}${c.is_nullable === "NO" ? " NOT NULL" : ""}`);
    await client.query(`CREATE TABLE ${q(table)} (${cols.join(", ")})`);
  }
  // Referenced primary keys must exist before foreign keys are restored.
  const orderedConstraints = [...prod.constraints].sort((a, b) =>
    Number(a.definition.startsWith("FOREIGN KEY")) - Number(b.definition.startsWith("FOREIGN KEY")));
  for (const c of orderedConstraints) {
    await client.query(`ALTER TABLE ${q(c.table_name)} ADD CONSTRAINT ${q(c.conname)} ${c.definition.replaceAll("public.", "phone_migration_validation.")}`);
  }
  for (const i of prod.indexes.filter(i => !prod.constraints.some(c => c.conname === i.indexname))) {
    await client.query(i.indexdef.replace("ON public.", "ON phone_migration_validation."));
  }
  for (const s of statements) {
    await client.query(s.replaceAll('"public".', '"phone_migration_validation".'));
  }
  // Check normalization, uniqueness, blank/null handling, and automatic recomputation.
  await client.query(`INSERT INTO businesses(business_name,retell_phone_number)
    VALUES ('fixture-one','+1 (555) 123-4567'),('fixture-null',NULL),('fixture-blank',''),
    ('fixture-nondigits','---'),('fixture-another-blank',' ')`);
  const normalized = await client.query("SELECT retell_phone_normalized FROM businesses WHERE business_name='fixture-one'");
  assert.equal(normalized.rows[0].retell_phone_normalized, "15551234567");
  await client.query("SAVEPOINT duplicate_phone");
  await assert.rejects(client.query(`INSERT INTO businesses(business_name,retell_phone_number)
    VALUES ('fixture-duplicate','15551234567')`), { code: "23505" });
  await client.query("ROLLBACK TO SAVEPOINT duplicate_phone");
  await client.query(`UPDATE businesses SET retell_phone_number='+1 555 765 4321' WHERE business_name='fixture-one'`);
  const updated = await client.query("SELECT retell_phone_normalized FROM businesses WHERE business_name='fixture-one'");
  assert.equal(updated.rows[0].retell_phone_normalized, "15557654321");
  console.log(`PASS: all ${statements.length} generated statements applied to an empty production-structure clone in a development transaction.`);
  console.log("PASS: normalized-phone uniqueness, formatted duplicates, multiple null/blank values, and automatic recomputation.");
  console.log("PASS: all original columns/types/defaults preserved; all production migration actions additive.");
  console.log(statements.join("\n"));
} finally {
  await client.query("ROLLBACK");
  client.release(); await pool.end();
}