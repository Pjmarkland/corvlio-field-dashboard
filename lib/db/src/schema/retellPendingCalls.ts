import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";
import { leadsTable } from "./leads";

export type RetellPendingCallStatus = "pending" | "resolved" | "fallback_created";

export const retellPendingCallsTable = pgTable(
  "retell_pending_calls",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    retellCallId: text("retell_call_id").notNull(),
    callerNumber: text("caller_number"),
    callStartedAt: timestamp("call_started_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    status: text("status").$type<RetellPendingCallStatus>().notNull().default("pending"),
    leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("retell_pending_calls_call_id_unique").on(table.retellCallId),
    index("retell_pending_calls_due_idx").on(table.status, table.deadlineAt),
  ],
);

export type RetellPendingCall = typeof retellPendingCallsTable.$inferSelect;
export type NewRetellPendingCall = typeof retellPendingCallsTable.$inferInsert;
