import { describe, expect, it } from "vitest";
import { databaseErrorFields, isMissingAccountDeletionTable } from "@workspace/db/errors";
import { productionSchemaAuditSql } from "../../../../lib/db/src/schemaAudit";

describe("safe database diagnostics", () => {
  it("extracts PostgreSQL causes without SQL, parameters, details or connection configuration", () => {
    const cause = Object.assign(new Error('relation "account_deletions" does not exist'), {
      code: "42P01", detail: "private row data", connectionString: "postgres://user:secret@host/db",
    });
    const fields = databaseErrorFields(new Error("Failed query: secret SQL params: secret", { cause }));
    expect(fields.databaseError.code).toBe("42P01");
    expect(fields.databaseError.message).toBe('relation "account_deletions" does not exist');
    expect(JSON.stringify(fields)).not.toMatch(/secret|private row|params|SELECT/);
    expect(isMissingAccountDeletionTable(new Error("outer", { cause }))).toBe(true);
  });
  it("redacts credential URLs, bearer tokens and keyed passwords", () => {
    const fields = databaseErrorFields(Object.assign(
      new Error('Cannot connect postgres://user:db-password@host/db password=another-secret token="secret-token" Bearer access-token'),
      { code: "ECONNREFUSED" },
    ));
    const rendered = JSON.stringify(fields);
    expect(rendered).toContain("ECONNREFUSED");
    expect(rendered).not.toMatch(/db-password|another-secret|secret-token|access-token/);
  });
  it("does not leak an unwrapped Drizzle SQL message", () => {
    expect(databaseErrorFields(new Error("Failed query: insert secret params: secret")).databaseError.message)
      .toBe("Database query failed (driver cause unavailable)");
  });
  it("keeps endpoint-disabled messages and nested connection errors diagnosable", () => {
    const cause = Object.assign(new Error("The endpoint has been disabled"), { code: "XX000" });
    expect(databaseErrorFields(new Error("query", { cause })).databaseError.message)
      .toBe("The endpoint has been disabled");
    const aggregate = databaseErrorFields(new AggregateError([
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    ], "connection failures"));
    expect(aggregate.databaseError.errors?.[0].code).toBe("ECONNREFUSED");
  });
  it("generates a SELECT-only audit including deletion, Retell, notification and billing schema", () => {
    const sql = productionSchemaAuditSql();
    for (const table of ["account_deletions", "pending_retell_releases", "businesses",
      "leads", "notification_events", "notification_poller_leases", "retell_call_records", "billing_accounts"]) {
      expect(sql).toContain(`'${table}'`);
    }
    expect(sql).toContain("'clerk_user_id'");
    expect(sql).toContain("'email_next_attempt_at'");
    expect(sql).not.toMatch(/\b(?:CREATE|ALTER|DROP|INSERT|DELETE|UPDATE|TRUNCATE)\b/i);
  });
});
