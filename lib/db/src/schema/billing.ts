import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";

export const billingAccountsTable = pgTable("billing_accounts", {
  businessId: integer("business_id").primaryKey().references(() => businessesTable.id),
  customerId: text("stripe_customer_id"),
  subscriptionId: text("stripe_subscription_id"),
  state: jsonb("state").$type<Record<string, unknown>>().notNull(),
}, table => [
  uniqueIndex("billing_customer_unique").on(table.customerId),
  uniqueIndex("billing_subscription_unique").on(table.subscriptionId),
]);
export const billingEventsTable = pgTable("billing_events", {
  id: text("id").primaryKey(),
  businessId: integer("business_id").references(() => businessesTable.id),
  type: text("type").notNull(),
  actor: text("actor"),
  detail: text("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const billingNoticesTable = pgTable("billing_notices", {
  id: text("id").primaryKey(),
  businessId: integer("business_id").notNull().references(() => businessesTable.id),
  audience: text("audience").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  delivery: jsonb("delivery").$type<{
    email: boolean;
    push: boolean;
    emailRecipients?: string[];
    deviceIds?: number[];
    emailSuppressed?: boolean;
  }>().notNull(),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
