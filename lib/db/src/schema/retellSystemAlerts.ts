import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";

export const retellSystemAlertsTable = pgTable(
  "retell_system_alerts",
  {
    id: serial("id").primaryKey(),
    issueKey: text("issue_key").notNull(),
    endpoint: text("endpoint", { enum: ["pre-call", "post-call", "stripe"] }).notNull(),
    category: text("category").notNull(),
    summary: text("summary").notNull(),
    details: text("details").notNull(),
    businessId: integer("business_id").references(() => businessesTable.id, { onDelete: "set null" }),
    businessName: text("business_name"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
  },
  (table) => [
    uniqueIndex("retell_system_alerts_issue_unique").on(table.issueKey),
    index("retell_system_alerts_last_seen_idx").on(table.lastSeenAt),
    index("retell_system_alerts_open_idx").on(table.resolvedAt, table.lastSeenAt),
  ],
);

export const retellWebhookHealthTable = pgTable("retell_webhook_health", {
  endpoint: text("endpoint", { enum: ["pre-call", "post-call"] }).primaryKey(),
  lastSuccessfulAt: timestamp("last_successful_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RetellSystemAlert = typeof retellSystemAlertsTable.$inferSelect;
