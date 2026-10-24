import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Minimal tombstone/outbox: no email, credentials, lead content or business profile.
export const accountDeletionsTable = pgTable("account_deletions", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  status: text("status").notNull().default("pending"),
  businessIds: integer("business_ids").array().notNull().default([]),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// Deliberately no business FK: these minimal release records must survive deletion.
export const pendingRetellReleasesTable = pgTable("pending_retell_releases", {
  id: serial("id").primaryKey(),
  sourceKey: text("source_key").notNull(),
  businessId: integer("business_id"),
  businessName: text("business_name").notNull(),
  phoneNumber: text("phone_number"),
  agentId: text("agent_id"),
  provisioningStatus: text("provisioning_status"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, table => [uniqueIndex("pending_retell_releases_source_unique").on(table.sourceKey)]);

// No business FK: cancellation retries must survive removal of the owner profile.
export const pendingBillingCancellationsTable = pgTable("pending_billing_cancellations", {
  id: serial("id").primaryKey(),
  sourceKey: text("source_key").notNull(),
  businessId: integer("business_id").notNull(),
  businessName: text("business_name").notNull(),
  subscriptionId: text("subscription_id"),
  checkoutSessionId: text("checkout_session_id"),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  claimUntil: timestamp("claim_until", { withTimezone: true }),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, table => [uniqueIndex("pending_billing_cancellations_source_unique").on(table.sourceKey)]);
