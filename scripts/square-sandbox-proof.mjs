// Operator-only Sandbox experiment. Not imported by the app, signup, or provisioning.
import { mkdir, readFile, writeFile, rename, open, unlink } from "node:fs/promises";
import { PLANS, isPlan } from "../artifacts/api-server/src/invoicing/policy.ts";
import { assertSandbox, squareClient, key, localDate, nextMonth, verifyInitialPayment, savedCards, monthlySubscription } from "./square-sandbox/client.mjs";

const [command, run, ...options] = process.argv.slice(2);
const planName = options.find(arg => !arg.startsWith("--")) ?? "professional";
const flags = options.filter(arg => arg.startsWith("--"));
let lock;
try {
  if (!["start", "complete"].includes(command) || !/^[a-zA-Z0-9_-]{8,40}$/.test(run ?? "")) {
    throw new Error("Usage: pnpm --filter @workspace/scripts square:sandbox start RUN_ID [plan]\nThen: ... complete RUN_ID --accept-sandbox-autopay-terms");
  }
  assertSandbox();
  const api = squareClient();
  const dir = new URL("../.local/square-sandbox/", import.meta.url);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = new URL(`${run}.json`, dir);
  lock = new URL(`${run}.lock`, dir);
  try { await (await open(lock, "wx", 0o600)).close(); }
  catch { lock = undefined; throw new Error("This run is already locked. Review an interrupted run before removing its lock."); }
  let state;
  try { state = JSON.parse(await readFile(file, "utf8")); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  async function save() {
    const temp = new URL(`${run}.json.tmp`, dir);
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temp, file);
  }
  if (command === "start") {
    if (!isPlan(planName)) throw new Error("Choose startup, starter, professional, or managed.");
    if (planName === "startup" && !flags.includes("--startup-approved")) {
      throw new Error("Startup requires --startup-approved for this Sandbox experiment; real approval is not changed.");
    }
    if (state && (state.plan !== planName || state.locationId !== process.env.SQUARE_LOCATION_ID)) {
      throw new Error("Run configuration changed. Do not reuse a run ID with a different plan or location.");
    }
    if (!state) {
      const { location } = await api(`/v2/locations/${encodeURIComponent(process.env.SQUARE_LOCATION_ID)}`);
      if (location?.currency !== "USD" || !location.timezone) throw new Error("A USD Sandbox location with a timezone is required.");
      state = { run, plan: planName, ...PLANS[planName], locationId: location.id,
        timeZone: location.timezone, issuedDate: localDate(new Date(), location.timezone), environment: "sandbox" };
      await save();
    }
    if (!state.customerId) {
      const { customer } = await api("/v2/customers", {
        idempotency_key: key(run, "customer"), given_name: "Corvlio Sandbox Proof",
        email_address: "square-proof@example.test", reference_id: `sandbox-proof:${run}`,
      });
      state.customerId = customer.id; await save();
    }
    if (!state.orderId) {
      const { order } = await api("/v2/orders", {
        idempotency_key: key(run, "order"),
        order: { location_id: state.locationId, customer_id: state.customerId, reference_id: run,
          line_items: [
            { name: `Corvlio ${state.plan} — first month`, quantity: "1", base_price_money: { amount: state.monthlyCents, currency: "USD" } },
            { name: "One-time setup", quantity: "1", base_price_money: { amount: state.setupCents, currency: "USD" } },
          ] },
      });
      state.orderId = order.id; await save();
    }
    if (!state.invoiceId) {
      const { invoice } = await api("/v2/invoices", {
        idempotency_key: key(run, "invoice"),
        invoice: { location_id: state.locationId, order_id: state.orderId,
          primary_recipient: { customer_id: state.customerId }, delivery_method: "SHARE_MANUALLY",
          payment_requests: [{ request_type: "BALANCE", due_date: state.issuedDate, automatic_payment_source: "NONE" }],
          accepted_payment_methods: { card: true, bank_account: false, square_gift_card: false, buy_now_pay_later: false, cash_app_pay: false },
          store_payment_method_enabled: true, title: "Corvlio SANDBOX — setup and first month" },
      });
      state.invoiceId = invoice.id; await save();
    }
    let { invoice } = await api(`/v2/invoices/${state.invoiceId}`);
    if (invoice.status === "DRAFT") {
      ({ invoice } = await api(`/v2/invoices/${state.invoiceId}/publish`, {
        idempotency_key: key(run, "publish"), version: invoice.version,
      }));
    }
    if (!invoice.public_url) throw new Error("Square has not returned a hosted invoice URL. Rerun the same start command.");
    if (invoice.store_payment_method_enabled !== true || invoice.accepted_payment_methods?.card !== true ||
        invoice.accepted_payment_methods?.bank_account === true) {
      throw new Error("Square did not confirm the required card-only/save-card settings. Review this invoice.");
    }
    console.log(`Sandbox hosted invoice: ${invoice.public_url}\nUse only Square Sandbox test card details. Select “Save my card on file.”\nNo Corvlio business or Retell state was changed.`);
  } else {
    if (!state?.invoiceId || state.environment !== "sandbox" || state.locationId !== process.env.SQUARE_LOCATION_ID) {
      throw new Error("Start this Sandbox run first, using the same location.");
    }
    if (!flags.includes("--accept-sandbox-autopay-terms")) {
      throw new Error("Add --accept-sandbox-autopay-terms to authorize this Sandbox experiment only. This is NOT a production signup consent record.");
    }
    if (state.subscriptionId) {
      const { subscription } = await api(`/v2/subscriptions/${state.subscriptionId}`);
      console.log(`Existing Sandbox subscription: ${subscription.id}; status: ${subscription.status}; starts: ${subscription.start_date}. No duplicate created.`);
    } else {
      const { invoice } = await api(`/v2/invoices/${state.invoiceId}`);
      const { order } = await api(`/v2/orders/${state.orderId}`);
      const paymentIds = [...new Set((order.tenders ?? []).map(t => t.payment_id).filter(Boolean))];
      const payments = await Promise.all(paymentIds.map(async id => (await api(`/v2/payments/${id}`)).payment));
      const paidAt = verifyInitialPayment(state, invoice, order, payments);
      const cards = await savedCards(api, state.customerId);
      if (!cards.length) throw new Error("Autopay setup incomplete: no saved card. No subscription was created.");
      if (cards.length !== 1) throw new Error("Multiple saved cards require explicit selection. No subscription was created.");
      const paidDate = localDate(paidAt, state.timeZone);
      state.startDate ??= nextMonth(paidDate);
      state.billingAnchorDay ??= Number(paidDate.slice(-2));
      if (state.startDate <= localDate(new Date(), state.timeZone)) {
        throw new Error("The next-month start date is no longer in the future. Review this old run; do not back-charge.");
      }
      await save();
      const subscription = await monthlySubscription(api, state, cards[0].id);
      state.subscriptionId = subscription.id; await save();
      console.log(`Sandbox subscription created: ${subscription.id}; status: ${subscription.status}; starts: ${subscription.start_date}.\nMonthly amount: USD ${(state.monthlyCents / 100).toFixed(2)}. No real charges or phone provisioning.`);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (lock) await unlink(lock);
}
