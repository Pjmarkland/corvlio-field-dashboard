import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";

export const billingEnforcementSettingsTable = pgTable("billing_enforcement_settings", {
  id: integer("id").primaryKey(),
  mode: text("mode", { enum: ["off", "dry_run", "enforce"] }).notNull().default("off"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export const billingEnforcementEventsTable = pgTable("billing_enforcement_events", {
  id: serial("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull(),
  businessId: integer("business_id").references(() => businessesTable.id, { onDelete: "set null" }),
  businessName: text("business_name"),
  source: text("source", { enum: ["stripe", "manual", "system"] }).notNull(),
  invoiceId: text("invoice_id"),
  action: text("action", {
    enum: [
      "would_suspend",
      "warning_day_3",
      "warning_day_5",
      "suspended",
      "reinstated",
      "manual_overdue_confirmed",
      "mode_changed",
      "override_changed",
    ],
  }).notNull(),
  actor: text("actor"),
  reason: text("reason").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("billing_enforcement_events_idempotency_unique").on(table.idempotencyKey),
]);
