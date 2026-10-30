// Static review only: reads local SQL, never connects to PostgreSQL or Retell.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../recovery/clear-eight-released-test-phone-numbers.sql", import.meta.url), "utf8");
const code = sql.replace(/--[^\n]*/g, "");
const targets = JSON.parse(sql.match(/\$targets\$([\s\S]*?)\$targets\$/)?.[1] ?? "null");
assert.deepEqual(targets, [
  { id: 4, expected_phone: "+15044749596" },
  { id: 5, expected_phone: "+15717091218" },
  { id: 6, expected_phone: "+19363031397" },
  { id: 7, expected_phone: "+17626001677" },
  { id: 8, expected_phone: "+17753679736" },
  { id: 9, expected_phone: "+16205089615" },
  { id: 10, expected_phone: "+19144514613" },
  { id: 11, expected_phone: "+15167249532" },
]);
assert.match(code, /confirmation text := 'PREVIEW ONLY';/);
assert.match(code, /IF confirmation IS NULL OR confirmation NOT IN \('PREVIEW ONLY', required_confirmation\)/);
assert.match(code, /PRODUCTION: CLEAR RELEASED PHONES 4-11; ACCEPT GENERATED NORMALIZATION/);
assert.doesNotMatch(code, /^\s*(?:BEGIN|COMMIT|START TRANSACTION|ROLLBACK)\s*;/im);
assert.doesNotMatch(code, /\b(?:INSERT|DELETE|ALTER|CREATE|DROP|TRUNCATE|EXECUTE|nextval|setval)\b/i);
assert.equal((code.match(/\bUPDATE\b/g) ?? []).length, 1);
assert.match(code, /UPDATE ONLY public\.businesses AS b\s+SET retell_phone_number = NULL\s+FROM expected AS t/);
assert.match(code, /WHERE b\.id = t\.id\s+AND b\.id IN \(4, 5, 6, 7, 8, 9, 10, 11\)\s+AND b\.id NOT IN \(1, 2, 3, 12\)\s+AND b\.retell_phone_number COLLATE pg_catalog\."C" = t\.expected_phone COLLATE pg_catalog\."C"/);
assert.match(code, /IF applying THEN\s+LOCK TABLE ONLY public\.businesses IN SHARE ROW EXCLUSIVE MODE/);
assert.match(code, /IF applying THEN\s+IF cardinality\(blockers\) > 0 THEN\s+RAISE EXCEPTION/);
assert.match(code, /changed_ids IS DISTINCT FROM ARRAY\[4, 5, 6, 7, 8, 9, 10, 11\]/);
assert.match(code, /after_businesses IS DISTINCT FROM expected_after/);
assert.match(code, /id = 12 AND business_name COLLATE pg_catalog\."C" = 'Corvlio'\s+AND retell_phone_number COLLATE pg_catalog\."C" = '\+16624994839'/);
for (const guard of ["pg_trigger", "pg_rewrite", "pg_inherits", "relrowsecurity", "pg_constraint", "attgenerated"]) {
  assert(code.includes(guard), `Missing schema side-effect guard: ${guard}`);
}
console.log("PASS: static SQL scope, preview, confirmation, schema guards and preservation checks. No SQL executed.");
