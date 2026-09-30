import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";

export const retellCallRecordsTable = pgTable(
  "retell_call_records",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    retellCallId: text("retell_call_id").notNull(),
    callStartedAt: timestamp("call_started_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    outcome: text("outcome"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("retell_call_records_retell_call_id_unique").on(table.retellCallId),
    index("retell_call_records_business_started_idx").on(table.businessId, table.callStartedAt),
  ],
);

export type RetellCallRecord = typeof retellCallRecordsTable.$inferSelect;
export type NewRetellCallRecord = typeof retellCallRecordsTable.$inferInsert;