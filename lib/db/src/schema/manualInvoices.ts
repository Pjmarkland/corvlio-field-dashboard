import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Separate from the disabled Stripe implementation. Never stores bank credentials.
export const invoiceSettingsTable = pgTable("invoice_settings", {
  id: integer("id").primaryKey(),
  instructions: text("instructions").notNull().default(""),
  paymentLink: text("payment_link").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const manualInvoicesTable = pgTable("manual_invoices", {
  id: serial("id").primaryKey(),
  // Keep the invoice's immutable business snapshot after the owner deletes the app account.
  businessId: integer("business_id").notNull(),
  businessName: text("business_name").notNull(),
  plan: text("plan").notNull(),
  periodKey: text("period_key").notNull(),
  monthlyCents: integer("monthly_cents").notNull(),
  setupCents: integer("setup_cents").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  overdueConfirmedAt: timestamp("overdue_confirmed_at", { withTimezone: true }),
  overdueConfirmedBy: text("overdue_confirmed_by"),
  paidBy: text("paid_by"),
  paymentReference: text("payment_reference"),
}, t => [uniqueIndex("manual_invoices_business_period_unique").on(t.businessId, t.periodKey)]);
export const invoiceEmailsTable = pgTable("invoice_emails", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => manualInvoicesTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("pending"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, t => [uniqueIndex("invoice_emails_invoice_kind_unique").on(t.invoiceId, t.kind)]);
