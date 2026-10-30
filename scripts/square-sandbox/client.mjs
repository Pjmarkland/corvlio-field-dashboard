import { createHash } from "node:crypto";

export function assertSandbox(env = process.env) {
  if (!env.REPLIT_DEV_DOMAIN || env.REPLIT_DEPLOYMENT || env.NODE_ENV === "production") {
    throw new Error("This proof runs only in the development workspace.");
  }
  if ((env.SQUARE_ENVIRONMENT ?? "sandbox") !== "sandbox") {
    throw new Error("This proof refuses production Square access. Set SQUARE_ENVIRONMENT=sandbox.");
  }
  const missing = ["SQUARE_ACCESS_TOKEN", "SQUARE_LOCATION_ID"].filter(key => !env[key]?.trim());
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(", ")}. Add it in workspace Secrets; never in chat.`);
}

export function squareClient(env = process.env, transport = fetch) {
  assertSandbox(env);
  return async (path, body, method = body ? "POST" : "GET") => {
    if (!path.startsWith("/v2/")) throw new Error("Only Square v2 paths are allowed.");
    const response = await transport(`https://connect.squareupsandbox.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
        "Square-Version": "2026-09-16",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json();
    if (!response.ok || data.errors?.length) {
      // Never print request bodies, authorization headers, or API responses containing customer data.
      throw new Error(`Square ${response.status}: ${(data.errors ?? []).map(e => e.code).join(", ") || "request failed"}`);
    }
    return data;
  };
}

export function key(run, action) {
  return createHash("sha256").update(`${run}:${action}`).digest("hex").slice(0, 40);
}

export function localDate(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(instant));
  const part = type => parts.find(p => p.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function nextMonth(date) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next.toISOString().slice(0, 10);
}

export function verifyInitialPayment(state, invoice, order, payments) {
  const usd = (money, expected) => money?.currency === "USD" && Number(money.amount) === expected;
  const total = state.monthlyCents + state.setupCents;
  if (invoice.id !== state.invoiceId || invoice.order_id !== state.orderId ||
      invoice.location_id !== state.locationId || invoice.primary_recipient?.customer_id !== state.customerId ||
      order.id !== state.orderId || order.customer_id !== state.customerId || order.location_id !== state.locationId ||
      !usd(order.total_money, total)) throw new Error("Initial invoice/order identity or expected total mismatch.");
  const requests = invoice.payment_requests ?? [];
  const completed = requests.reduce((n, p) => n + Number(p.total_completed_amount_money?.amount ?? 0), 0);
  if (invoice.status !== "PAID" || completed !== total ||
      requests.some(p => p.total_completed_amount_money?.currency !== "USD")) {
    throw new Error("Initial invoice is not fully paid. No subscription was created.");
  }
  if (!payments.length || payments.some(p =>
    p.order_id !== state.orderId || p.location_id !== state.locationId || p.customer_id !== state.customerId ||
    p.status !== "COMPLETED" || p.source_type !== "CARD" || p.amount_money?.currency !== "USD" ||
    Number(p.refunded_money?.amount ?? 0) !== 0 || !p.updated_at ||
    !Number.isFinite(new Date(p.updated_at).getTime())
  ) || payments.reduce((n, p) => n + Number(p.amount_money?.amount ?? 0), 0) !== total) {
    throw new Error("Full completed card payment could not be verified. No subscription was created.");
  }
  return payments.map(p => p.updated_at).sort().at(-1);
}

export async function savedCards(api, customerId) {
  const cards = [];
  let cursor;
  do {
    const query = new URLSearchParams({ customer_id: customerId });
    if (cursor) query.set("cursor", cursor);
    const page = await api(`/v2/cards?${query}`);
    cards.push(...(page.cards ?? []).filter(c => c.enabled === true && c.customer_id === customerId));
    cursor = page.cursor;
  } while (cursor);
  return cards;
}

export async function monthlySubscription(api, state, cardId) {
  if (!cardId) throw new Error("Autopay setup incomplete: a saved card is required.");
  const money = { amount: state.monthlyCents, currency: "USD" };
  const { catalog_object: plan } = await api("/v2/catalog/object", {
    idempotency_key: key(state.run, "plan"),
    object: { id: "#plan", type: "SUBSCRIPTION_PLAN", present_at_all_locations: true,
      subscription_plan_data: { name: `Corvlio SANDBOX ${state.run}` } },
  });
  const { catalog_object: variation } = await api("/v2/catalog/object", {
    idempotency_key: key(state.run, "variation"),
    object: { id: "#variation", type: "SUBSCRIPTION_PLAN_VARIATION", present_at_all_locations: true,
      subscription_plan_variation_data: {
        name: "Monthly card autopay", subscription_plan_id: plan.id,
        can_prorate: false, monthly_billing_anchor_date: state.billingAnchorDay,
        phases: [{ cadence: "MONTHLY", pricing: { type: "STATIC", price_money: money } }],
      } },
  });
  const { subscription } = await api("/v2/subscriptions", {
    idempotency_key: key(state.run, "subscription"),
    location_id: state.locationId, customer_id: state.customerId,
    plan_variation_id: variation.id, card_id: cardId, start_date: state.startDate,
    monthly_billing_anchor_date: state.billingAnchorDay,
    timezone: state.timeZone,
  });
  if (!subscription?.id || subscription.customer_id !== state.customerId ||
      subscription.location_id !== state.locationId || subscription.card_id !== cardId ||
      subscription.plan_variation_id !== variation.id || subscription.start_date !== state.startDate) {
    throw new Error("Square subscription response requires review. Rerun with the same run ID; do not create another run.");
  }
  return subscription;
}
