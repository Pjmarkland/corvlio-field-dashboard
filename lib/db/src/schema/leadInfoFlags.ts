import { sql } from "drizzle-orm";
import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";
import { leadsTable } from "./leads";

export const leadInfoFlagsTable = pgTable("lead_info_flags", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id")
    .notNull()
    .references(() => businessesTable.id, { onDelete: "cascade" }),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leadsTable.id, { onDelete: "cascade" }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"),
}, (table) => [
  index("lead_info_flags_unresolved_created_idx").on(table.resolvedAt, table.createdAt),
  uniqueIndex("lead_info_flags_one_open_per_lead_unique")
    .on(table.leadId)
    .where(sql`${table.resolvedAt} IS NULL`),
]);

export type LeadInfoFlag = typeof leadInfoFlagsTable.$inferSelect;
export type NewLeadInfoFlag = typeof leadInfoFlagsTable.$inferInsert;
