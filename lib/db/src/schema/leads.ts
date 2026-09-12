import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";

export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id")
    .notNull()
    .references(() => businessesTable.id, { onDelete: "cascade" }),
  callerName: text("caller_name"),
  phoneNumber: text("phone_number"),
  issueReason: text("issue_reason"),
  address: text("address"),
  urgencyLevel: text("urgency_level"),
  availability: text("availability"),
  status: text("status").notNull().default("new"),
  contactedAt: timestamp("contacted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Lead = typeof leadsTable.$inferSelect;
export type NewLead = typeof leadsTable.$inferInsert;