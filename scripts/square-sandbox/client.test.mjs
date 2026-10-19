import test from "node:test";
import assert from "node:assert/strict";
import { assertSandbox, squareClient, key, localDate, nextMonth, verifyInitialPayment, savedCards, monthlySubscription } from "./client.mjs";

const env = { REPLIT_DEV_DOMAIN: "test.replit.dev", SQUARE_ACCESS_TOKEN: "test-only-token", SQUARE_LOCATION_ID: "L1" };
const state = { run: "sandbox-proof-1", locationId: "L1", customerId: "C1", orderId: "O1", invoiceId: "I1",
  monthlyCents: 100000, setupCents: 30000, startDate: "2026-11-30", billingAnchorDay: 31, timeZone: "America/New_York" };
const money = amount => ({ amount, currency: "USD" });
const invoice = { id: "I1", location_id: "L1", order_id: "O1", status: "PAID",
  primary_recipient: { customer_id: "C1" }, payment_requests: [{ total_completed_amount_money: money(130000) }] };
const order = { id: "O1", location_id: "L1", customer_id: "C1", total_money: money(130000) };
const payment = { id: "P1", order_id: "O1", location_id: "L1", customer_id: "C1", status: "COMPLETED",
  source_type: "CARD", amount_money: money(130000), updated_at: "2026-10-31T20:00:00Z" };

test("defaults to sandbox; refuses production and missing configuration", () => {
  assert.doesNotThrow(() => assertSandbox(env));
  for (const patch of [{ SQUARE_ENVIRONMENT: "production" }, { NODE_ENV: "production" },
    { REPLIT_DEPLOYMENT: "1" }, { REPLIT_DEV_DOMAIN: "" }, { SQUARE_ACCESS_TOKEN: "" }, { SQUARE_LOCATION_ID: "" }]) {
    assert.throws(() => assertSandbox({ ...env, ...patch }));
  }
});

test("transport is pinned to Sandbox; failure output excludes API details and token", async () => {
  let request;
  const api = squareClient(env, async (url, options) => {
    request = { url, options };
    return { ok: false, status: 401, json: async () => ({ errors: [{ code: "UNAUTHORIZED", detail: "sensitive customer detail" }] }) };
  });
  await assert.rejects(api("/v2/customers", { email_address: "test@example.test" }), error =>
    error.message === "Square 401: UNAUTHORIZED");
  assert.equal(request.url, "https://connect.squareupsandbox.com/v2/customers");
  assert.equal(request.options.headers["Square-Version"], "2026-09-16");
  await assert.rejects(api("https://other.example/v2/customers"), /Only Square/);
});

test("idempotency keys are stable per run/action and bounded", () => {
  assert.equal(key("proof-1", "subscription"), key("proof-1", "subscription"));
  assert.notEqual(key("proof-1", "invoice"), key("proof-1", "subscription"));
  assert.equal(key("proof-1", "subscription").length, 40);
});

test("next month clamps month ends and uses the seller's timezone", () => {
  assert.equal(nextMonth("2026-01-31"), "2026-02-28");
  assert.equal(nextMonth("2028-01-31"), "2028-02-29");
  assert.equal(nextMonth("2026-12-31"), "2027-01-31");
  assert.equal(localDate("2026-11-01T02:00:00Z", "America/New_York"), "2026-10-31");
});

test("full matching completed payment is required, not invoice status alone", () => {
  assert.equal(verifyInitialPayment(state, invoice, order, [payment]), payment.updated_at);
  for (const patch of [{ status: "PENDING" }, { status: "FAILED" }, { source_type: "BANK_ACCOUNT" },
    { customer_id: "other" }, { location_id: "other" }, { order_id: "other" },
    { amount_money: money(100000) }, { refunded_money: money(1) }, { updated_at: "invalid" }]) {
    assert.throws(() => verifyInitialPayment(state, invoice, order, [{ ...payment, ...patch }]));
  }
  assert.throws(() => verifyInitialPayment(state, { ...invoice, status: "PARTIALLY_PAID" }, order, [payment]));
  assert.throws(() => verifyInitialPayment(state, { ...invoice, order_id: "other" }, order, [payment]));
  assert.throws(() => verifyInitialPayment(state, invoice, { ...order, total_money: money(1) }, [payment]));
  assert.throws(() => verifyInitialPayment(state, invoice, order, []));
});

test("cards are paginated and must be enabled and belong to the exact customer", async () => {
  let calls = 0;
  const cards = await savedCards(async () => ++calls === 1
    ? { cursor: "page2", cards: [{ id: "disabled", enabled: false, customer_id: "C1" }] }
    : { cards: [{ id: "foreign", enabled: true, customer_id: "other" }, { id: "card1", enabled: true, customer_id: "C1" }] }, "C1");
  assert.equal(calls, 2);
  assert.deepEqual(cards.map(c => c.id), ["card1"]);
});

test("monthly subscription excludes setup, starts next month and requires card", async () => {
  const calls = [];
  const api = async (path, body) => {
    calls.push({ path, body });
    if (calls.length < 3) return { catalog_object: { id: calls.length === 1 ? "plan1" : "variation1" } };
    return { subscription: { id: "S1", customer_id: "C1", location_id: "L1", card_id: "card1",
      plan_variation_id: "variation1", start_date: state.startDate } };
  };
  const result = await monthlySubscription(api, state, "card1");
  assert.equal(result.id, "S1");
  const data = calls[1].body.object.subscription_plan_variation_data;
  assert.deepEqual(data.phases, [{ cadence: "MONTHLY", pricing: { type: "STATIC", price_money: money(100000) } }]);
  assert.equal(data.can_prorate, false);
  assert.equal(data.monthly_billing_anchor_date, 31);
  assert.equal(calls[2].body.start_date, "2026-11-30");
  assert.equal(calls[2].body.card_id, "card1");
  assert.equal(calls[2].body.idempotency_key, key(state.run, "subscription"));
});

test("mismatched subscription response requires review rather than reporting success", async () => {
  let calls = 0;
  await assert.rejects(monthlySubscription(async () => ++calls < 3
    ? { catalog_object: { id: "catalog" } }
    : { subscription: { id: "S1", card_id: "other" } }, state, "card1"), /requires review/);
});

test("missing saved card never creates an invoice-only subscription", async () => {
  let called = false;
  await assert.rejects(monthlySubscription(async () => { called = true; }, state, undefined), /Autopay setup incomplete/);
  assert.equal(called, false);
});
