import { vi } from "vitest";
import type Stripe from "stripe";
import { BillingService, type SubscriptionData } from "../../src/billing/service";
import { initialBillingState, type BillingState } from "../../src/billing/policy";
import type { BillingNotice, BillingStore } from "../../src/billing/store";

export function billingFixture() {
  const states = new Map<number, BillingState>();
  const events = new Map<string, { id: string; businessId: number; type: string; detail: string; actor: string | null; createdAt: string }>();
  const notices = new Map<string, BillingNotice>();
  const calls = new Map<number, number>();
  let clock = new Date("2026-10-10T10:00:00Z");
  let subscription: SubscriptionData = {
    id: "sub_test_1", customer: "cus_test_1", status: "active", start_date: Date.parse("2026-10-01T00:00:00Z") / 1000,
    items: { data: [{ id: "si_test_1", current_period_start: Date.parse("2026-10-01T00:00:00Z") / 1000, current_period_end: Date.parse("2026-11-01T00:00:00Z") / 1000,
      price: { id: "price_monthly", metadata: { corvlio_plan: "starter" } } }] },
  };
  const business = (id: number) => id === 1 || id === 2
    ? { id, businessName: `Business ${id}`, ownerEmail: `${id}@example.test`, clerkUserId: `owner-${id}` } : null;
  const store: BillingStore = {
    business: async id => business(id), businesses: async () => [business(1)!, business(2)!],
    timeline: async id => [...events.values()].filter(e => e.businessId === id),
    hasEvent: async id => events.has(id),
    findByStripe: async (customerId, subId) => [...states].find(([, s]) => s.customerId === customerId || (!!subId && s.subscriptionId === subId))?.[0] ?? null,
    async transact(id, work) {
      const state = structuredClone(states.get(id) ?? initialBillingState());
      const stagedEvents = new Map(events), stagedNotices = new Map(notices);
      const result = await work({
        state, countCalls: async () => calls.get(id) ?? 0,
        claimEvent: async (eventId, type, detail, at, actor) => {
          if (stagedEvents.has(eventId)) return false;
          stagedEvents.set(eventId, { id: eventId, businessId: id, type, detail, actor: actor ?? null, createdAt: at.toISOString() });
          return true;
        },
        notice: async n => { const key = `${id}:${n.key}:${n.audience}`; if (!stagedNotices.has(key)) stagedNotices.set(key, n); },
      });
      states.set(id, state);
      events.clear(); stagedEvents.forEach((v, k) => events.set(k, v));
      notices.clear(); stagedNotices.forEach((v, k) => notices.set(k, v));
      return result;
    },
  };
  const prices = new Map<string, object>();
  const sdk = {
    prices: {
      list: vi.fn(async ({ lookup_keys }: { lookup_keys: string[] }) => ({ data: prices.has(lookup_keys[0]) ? [prices.get(lookup_keys[0])] : [] })),
      create: vi.fn(async (params: { lookup_key: string }) => {
        const price = { ...params, id: `price_${params.lookup_key}`, livemode: false };
        prices.set(params.lookup_key, price); return price;
      }),
    },
    customers: { create: vi.fn(async () => ({ id: "cus_test_1", livemode: false })) },
    checkout: { sessions: {
      create: vi.fn(async () => ({ id: "cs_test_1", url: "https://checkout.stripe.com/test-session", livemode: false })),
      retrieve: vi.fn(async () => ({ id: "cs_test_1", status: "open", url: "https://checkout.stripe.com/test-session", livemode: false })),
      expire: vi.fn(async () => ({ id: "cs_test_1", status: "expired" })),
    } },
    subscriptions: {
      retrieve: vi.fn(async () => structuredClone(subscription)),
      update: vi.fn(async () => structuredClone(subscription)),
    },
    billingPortal: {
      configurations: {
        list: vi.fn(async () => ({ data: [] })),
        create: vi.fn(async (params: object) => ({ ...params, id: "bpc_test", active: true })),
      },
      sessions: { create: vi.fn(async () => ({ url: "https://billing.stripe.com/test-portal" })) },
    },
  };
  const service = new BillingService(store, () => sdk as unknown as Stripe, () => clock);
  const state = (id = 1) => states.get(id)!;
  function subscribed(id = 1, changes: Partial<BillingState> = {}) {
    states.set(id, { ...initialBillingState(), customerId: `cus_test_${id}`, subscriptionId: `sub_test_${id}`, plan: "starter",
      status: "active", periodStart: "2026-10-01T00:00:00Z", periodEnd: "2026-11-01T00:00:00Z",
      paidPeriodEnd: "2026-11-01T00:00:00Z", setupPaid: true, ...changes });
  }
  function event(type: string, id: string, at = clock, object: object = { id: "in_test", customer: "cus_test_1", subscription: "sub_test_1" }) {
    return { id, type, created: Math.floor(at.getTime() / 1000), livemode: false, data: { object } } as unknown as Stripe.Event;
  }
  return { service, sdk, store, states, state, subscribed, notices, calls, events, event,
    setNow: (date: string) => { clock = new Date(date); },
    setSubscription: (data: Partial<SubscriptionData>) => { subscription = { ...subscription, ...data }; },
  };
}
