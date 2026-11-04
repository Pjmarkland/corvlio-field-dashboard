import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const supportRequestsTable = pgTable("support_requests", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  businessName: text("business_name").notNull(),
  ownerEmail: text("owner_email").notNull(),
  message: text("message").notNull(),
  urgent: boolean("urgent").notNull().default(false),
  status: text("status").notNull().default("open"),
  emailStatus: text("email_status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("support_requests_created_idx").on(table.createdAt),
  index("support_requests_status_created_idx").on(table.status, table.createdAt),
]);

export type SupportRequest = typeof supportRequestsTable.$inferSelect;
