import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { pathToFileURL } from "node:url";
import * as schema from "./schema";

/** Generate a SELECT-only audit of every declared table/column; no DB connection. */
export function productionSchemaAuditSql(): string {
  const expected = new Set<string>();
  const quote = (name: string) => `'${name.replaceAll("'", "''")}'`;
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const table = getTableConfig(value);
    for (const column of table.columns) {
      expected.add(`(${quote(table.schema ?? "public")}, ${quote(table.name)}, ${quote(column.name)})`);
    }
  }
  if (!expected.size) throw new Error("No declared tables found; refusing an empty schema audit.");
  return `-- Read-only. Empty result = all declared table/column names are present.
-- This checks presence, not types, indexes, functions or custom triggers.
WITH expected(schema_name, table_name, column_name) AS (
  VALUES
  ${[...expected].sort().join(",\n  ")}
)
SELECT e.schema_name, e.table_name, e.column_name,
  CASE WHEN t.table_name IS NULL THEN 'missing_table' ELSE 'missing_column' END AS problem
FROM expected e
LEFT JOIN information_schema.tables t
  ON t.table_schema = e.schema_name AND t.table_name = e.table_name
LEFT JOIN information_schema.columns c
  ON c.table_schema = e.schema_name AND c.table_name = e.table_name AND c.column_name = e.column_name
WHERE c.column_name IS NULL
ORDER BY e.schema_name, e.table_name, e.column_name;
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(productionSchemaAuditSql());
}
