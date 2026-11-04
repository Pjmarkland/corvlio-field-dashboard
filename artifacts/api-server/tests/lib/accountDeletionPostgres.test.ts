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
      CREATE TEMP TABLE pending_billing_cancellations (id serial PRIMARY KEY, source_key text UNIQUE, business_id int,
        business_name text, subscription_id text, checkout_session_id text, status text DEFAULT 'pending',
        attempts int DEFAULT 0, claim_until timestamptz, last_error text, next_attempt_at timestamptz DEFAULT now(),
        created_at timestamptz DEFAULT now(), resolved_at timestamptz);
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
      CREATE TEMP TABLE retell_pending_calls (business_id int REFERENCES businesses(id));
      CREATE TEMP TABLE owner_demo_calls (business_id int REFERENCES businesses(id));
      CREATE TEMP TABLE operational_failures (event_key text UNIQUE, source text, summary text, details text,
        business_id int REFERENCES businesses(id), business_name text);
      CREATE TEMP TABLE billing_events (id text PRIMARY KEY, business_id int REFERENCES businesses(id), actor text);
      CREATE TEMP TABLE billing_notices (business_id int REFERENCES businesses(id));
      CREATE TEMP TABLE manual_invoices (id int PRIMARY KEY, business_id int REFERENCES businesses(id),
        business_name text NOT NULL, monthly_cents int NOT NULL, setup_cents int NOT NULL,
        paid_at timestamptz, payment_reference text);
      CREATE TEMP TABLE invoice_emails (invoice_id int);
      CREATE TEMP TABLE email_health_attempts (actor_user_id text);
    `);
    expect((await client.query("SHOW search_path")).rows[0].search_path).toBe("pg_temp");
    const migration = readFileSync(new URL("../../../../scripts/migrate-account-deletion.sql", import.meta.url), "utf8");
    const invoiceFkMigration = migration.match(/DO \$\$\s*DECLARE constraint_name text;[\s\S]*?END \$\$;/)![0];
    await client.query(invoiceFkMigration);
    expect((await client.query(`SELECT count(*)::int AS count FROM pg_constraint
      WHERE conrelid='manual_invoices'::regclass AND confrelid='businesses'::regclass AND contype='f'`)).rows[0].count).toBe(0);
    const fn = migration.match(/CREATE OR REPLACE FUNCTION guard_deleted_account_data[\s\S]*?END \$\$;/)![0]
      .replace("FUNCTION guard_deleted_account_data", "FUNCTION pg_temp.guard_deleted_account_data");
    await client.query(fn);
    for (const table of ["businesses", "notification_devices", "notification_events", "notification_seen_leads",
      "notification_poll_state", "provisioning_attempts", "retell_pending_calls"]) {
      await client.query(`CREATE TRIGGER guard_fixture BEFORE INSERT OR UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION pg_temp.guard_deleted_account_data()`);
    }
    deps = { pool: { query: (text, args) => client.query(text, args),
      connect: async () => ({ query: (text, args) => client.query(text, args), release: () => {} }) }, deleteUser: identity };
    await client.query(`INSERT INTO businesses VALUES
      (7001,'user_fixture_owner','Fictional HVAC','+12395550101','agent_fixture','ready'),
      (7002,'user_fixture_other','Other fictional company','+12395550102','other_agent','ready')`);
    for (const table of ["leads", "retell_call_records", "retell_pending_calls", "owner_demo_calls", "billing_notices"]) {
      await client.query(`INSERT INTO ${table} (business_id) VALUES (7001),(7002)`);
    }
    await client.query(`INSERT INTO operational_failures (event_key,source,summary,details,business_id)
      VALUES ('fixture-owner-failure','post_call_webhook','Fixture failure','test',7001),
             ('fixture-other-failure','post_call_webhook','Fixture failure','test',7002);
      INSERT INTO billing_events (id,business_id,actor) VALUES ('evt_fixture_owner',7001,'user_fixture_owner'),
        ('evt_fixture_other',7002,'user_fixture_other');
      INSERT INTO manual_invoices (id,business_id,business_name,monthly_cents,setup_cents,paid_at,payment_reference)
      VALUES (8101,7001,'Fictional HVAC',5000,1500,NULL,NULL),
             (8102,7001,'Fictional HVAC',5000,0,now(),'cash receipt 8102'),
             (8201,7002,'Other fictional company',4500,0,now(),'receipt 8201');
      INSERT INTO invoice_emails (invoice_id) VALUES (8101),(8201);`);
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
  it("deletes despite past-due billing, preserves ledger history, retries identity deletion, and prevents resurrection", async () => {
    identity.mockRejectedValueOnce(new Error("Mock Clerk outage"));
    expect(await deleteAccount("user_fixture_owner", deps)).toBe("pending");
    expect((await client.query("SELECT * FROM businesses")).rows.map(r => r.id)).toEqual([7002]);
    for (const table of ["leads", "notification_events", "notification_seen_leads", "notification_poll_state",
      "retell_call_records", "retell_pending_calls", "owner_demo_calls", "billing_notices"]) {
      expect((await client.query(`SELECT * FROM ${table}`)).rows.map(r => String(r.business_id))).toEqual(["7002"]);
    }
    expect((await client.query("SELECT business_id FROM operational_failures WHERE business_id IS NOT NULL")).rows
      .map(r => String(r.business_id))).toEqual(["7002"]);
    expect((await client.query("SELECT * FROM operational_failures WHERE source='account_deletion_balance'")).rows)
      .toHaveLength(1);
    const ledger = (await client.query("SELECT id,business_id,actor FROM billing_events ORDER BY id")).rows;
    expect(ledger).toEqual([
      { id: "evt_fixture_other", business_id: 7002, actor: "user_fixture_other" },
      { id: "evt_fixture_owner", business_id: null, actor: null },
    ]);
    const invoices = (await client.query("SELECT id,business_id,payment_reference FROM manual_invoices ORDER BY id")).rows;
    expect(invoices).toEqual([
      { id: 8101, business_id: 7001, payment_reference: null },
      { id: 8102, business_id: 7001, payment_reference: "cash receipt 8102" },
      { id: 8201, business_id: 7002, payment_reference: "receipt 8201" },
    ]);
    expect((await client.query("SELECT invoice_id FROM invoice_emails")).rows.map(r => r.invoice_id)).toEqual([8201]);
    expect((await client.query("SELECT source_key FROM pending_billing_cancellations")).rows).toHaveLength(1);
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
