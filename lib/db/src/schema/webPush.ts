import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";
import { notificationEventsTable } from "./notifications";

export const webPushSubscriptionsTable = pgTable(
  "web_push_subscriptions",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    businessId: integer("business_id").notNull().references(() => businessesTable.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    expirationAt: timestamp("expiration_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("web_push_subscriptions_endpoint_unique").on(table.endpoint)],
);

export const webPushDeliveriesTable = pgTable(
  "web_push_deliveries",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull().references(() => notificationEventsTable.id, { onDelete: "cascade" }),
    subscriptionId: integer("subscription_id").notNull().references(() => webPushSubscriptionsTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    claimUntil: timestamp("claim_until", { withTimezone: true }),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("web_push_deliveries_event_subscription_unique").on(table.eventId, table.subscriptionId),
    index("web_push_deliveries_due_idx").on(table.status, table.nextAttemptAt),
  ],
);

export type WebPushSubscription = typeof webPushSubscriptionsTable.$inferSelect;
export type WebPushDelivery = typeof webPushDeliveriesTable.$inferSelect;
