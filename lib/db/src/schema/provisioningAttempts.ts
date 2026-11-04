import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";

// Purchase journal survives business deletion. Uncertain requests are never automatically retried.
export const provisioningAttemptsTable = pgTable("provisioning_attempts", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull(),
  businessId: integer("business_id").references(() => businessesTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("reserved"),
  purchasedNumber: text("purchased_number"),
  reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
}, (table) => [
  uniqueIndex("provisioning_attempts_account_unique").on(table.clerkUserId),
  index("provisioning_attempts_purchased_at_idx").on(table.purchasedAt),
]);