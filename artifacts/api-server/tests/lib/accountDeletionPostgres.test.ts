import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { pool } from "@workspace/db";
import { deleteAccount, type DeletionDependencies } from "../../src/lib/accountDeletion";

// Never resolves public app tables. All rows and destructive statements below
// live in this connection's disposable pg_temp namespace; Clerk is always mocked.
describe.skipIf(!process.env.REPLIT_DEV_DOMAIN || !!process.env.REPLIT_DEPLOYMENT)("account deletion — isolated temporary PostgreSQL", () => {
  let client: Awaited<ReturnType<typeof pool.connect>>;
  const identity = vi.fn().mockResolvedValue({});
  let deps: DeletionDependencies;
  beforeAll(async () => {
    client = await pool.connect();
    await client.query("SET search_path TO pg_temp");
    await client.query(`
      CREATE TEMP TABLE businesses (id int PRIMARY KEY, clerk_user_id text, business_name text,
        retell_phone_number text, retell_agent_id text, provisioning_state text);
      CREATE TEMP TABLE account_deletions (clerk_user_id text PRIMARY KEY, business_ids int[] NOT NULL DEFAULT '{}',
        status text DEFAULT 'pending', attempts int DEFAULT 0, last_error text, next_attempt_at timestamptz DEFAULT now(), completed_at timestamptz);
      CREATE TEMP TABLE pending_retell_releases (source_key text UNIQUE, business_id int, business_name text,
        phone_number text, agent_id text, provisioning_status text);
      CREATE TEMP TABLE billing_accounts (business_id int REFERENCES businesses(id), state jsonb, stripe_subscription_id text);
      CREATE TEMP TABLE notification_devices (id int PRIMARY KEY, clerk_user_id text, business_id text);
      CREATE TEMP TABLE notification_events (id int PRIMARY KEY, business_id text);
      CREATE TEMP TABLE notification_delivery_attempts (id int, event_id int REFERENCES notification_events(id) ON DELETE CASCADE,
        device_id int REFERENCES notification_devices(id) ON DELETE CASCADE);
      CREATE TEMP TABLE notification_seen_leads (business_id text);
      CREATE TEMP TABLE notification_poll_state (business_id text);
      CREATE TEMP TABLE provisioning_attempts (id int, clerk_user_id text, business_id int, purchased_number text, status text);
      CREATE TEMP TABLE leads (business_id int REFERENCES businesses(id));
      CREATE TEMP TABLE retell_call_records (business_id int REFERENCES businesses(id));
      CREATE TEMP TABLE owner_demo_calls (business_id int REFERENCES businesses(id));
      CREATE TEMP TABLE operational_failures (business_id int REFERENCES businesses(id));
      CREATE TEMP TABLE billing_events (business_id int REFERENCES businesses(id));
      CREATE TEMP TABLE billing_notices (business_id int REFERENCES businesses(id));
      CREATE TEMP TABLE manual_invoices (id int, business_id int REFERENCES businesses(id));
      CREATE TEMP TABLE invoice_emails (invoice_id int);
      CREATE TEMP TABLE email_health_attempts (actor_user_id text);
    `);
    expect((await client.query("SHOW search_path")).rows[0].search_path).toBe("pg_temp");
    const migration = readFileSync(new URL("../../../../scripts/migrate-account-deletion.sql", import.meta.url), "utf8");
    const fn = migration.match(/CREATE OR REPLACE FUNCTION guard_deleted_account_data[\s\S]*?END \$\$;/)![0]
      .replace("FUNCTION guard_deleted_account_data", "FUNCTION pg_temp.guard_deleted_account_data");
    await client.query(fn);
    for (const table of ["businesses", "notification_devices", "notification_events", "notification_seen_leads",
      "notification_poll_state", "provisioning_attempts"]) {
      await client.query(`CREATE TRIGGER guard_fixture BEFORE INSERT OR UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION pg_temp.guard_deleted_account_data()`);
    }
    deps = { pool: { query: (text, args) => client.query(text, args),
      connect: async () => ({ query: (text, args) => client.query(text, args), release: () => {} }) }, deleteUser: identity };
    await client.query(`INSERT INTO businesses VALUES
      (7001,'user_fixture_owner','Fictional HVAC','+12395550101','agent_fixture','ready'),
      (7002,'user_fixture_other','Other fictional company','+12395550102','other_agent','ready')`);
    for (const table of ["leads", "retell_call_records", "owner_demo_calls", "operational_failures", "billing_events", "billing_notices"]) {
      await client.query(`INSERT INTO ${table} (business_id) VALUES (7001),(7002)`);
    }
    for (const table of ["notification_seen_leads", "notification_poll_state"]) {
      await client.query(`INSERT INTO ${table} (business_id) VALUES ('7001'),('7002')`);
    }
    await client.query(`INSERT INTO notification_devices VALUES (1,'user_fixture_owner','7001'),(2,'user_fixture_other','7002');
      INSERT INTO notification_events VALUES (1,'7001'),(2,'7002');
      INSERT INTO notification_delivery_attempts VALUES (1,1,1),(2,2,2);
      INSERT INTO billing_accounts VALUES (7001,'{"status":"past_due","plan":"starter"}','sub_fixture');
      INSERT INTO provisioning_attempts VALUES (1,'user_fixture_owner',7001,'+12395550101','purchased');`);
  });
  afterAll(async () => {
    if (client) { await client.query("DISCARD TEMP"); await client.query("RESET search_path"); client.release(); }
  });
  it("enforces paid refusal, isolated cleanup, retry/idempotency, cascades and anti-resurrection triggers", async () => {
    await expect(deleteAccount("user_fixture_owner", deps)).rejects.toThrow("paid subscription");
    expect((await client.query("SELECT * FROM businesses")).rows).toHaveLength(2);
    expect(identity).not.toHaveBeenCalled();
    await client.query(`UPDATE billing_accounts SET state = '{"status":"canceled","plan":"starter"}' WHERE business_id = 7001`);
    identity.mockRejectedValueOnce(new Error("Mock Clerk outage"));
    expect(await deleteAccount("user_fixture_owner", deps)).toBe("pending");
    expect((await client.query("SELECT * FROM businesses")).rows.map(r => r.id)).toEqual([7002]);
    for (const table of ["leads", "notification_events", "notification_seen_leads", "notification_poll_state",
      "retell_call_records", "owner_demo_calls", "operational_failures", "billing_events", "billing_notices"]) {
      expect((await client.query(`SELECT * FROM ${table}`)).rows.map(r => String(r.business_id))).toEqual(["7002"]);
    }
    expect((await client.query("SELECT * FROM notification_devices")).rows[0].clerk_user_id).toBe("user_fixture_other");
    expect((await client.query("SELECT * FROM notification_delivery_attempts")).rows.map(r => r.id)).toEqual([2]);
    expect((await client.query("SELECT * FROM pending_retell_releases")).rows).toHaveLength(1);
    await expect(client.query("INSERT INTO notification_events VALUES (3,'7001')")).rejects.toThrow("Deleted business");
    await expect(client.query("INSERT INTO businesses VALUES (7003,'user_fixture_owner','Resurrection',null,null,'pending')")).rejects.toThrow("Account deletion");
    expect(await deleteAccount("user_fixture_owner", deps)).toBe("completed");
    expect(await deleteAccount("user_fixture_owner", deps)).toBe("completed");
    expect(identity).toHaveBeenCalledTimes(2);
    expect((await client.query("SELECT * FROM pending_retell_releases")).rows).toHaveLength(1);
  });
});
