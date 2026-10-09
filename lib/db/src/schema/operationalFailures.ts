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

export const operationalFailuresTable = pgTable(
  "operational_failures",
  {
    id: serial("id").primaryKey(),
    eventKey: text("event_key").notNull(),
    source: text("source").notNull(),
    summary: text("summary").notNull(),
    details: text("details").notNull(),
    businessId: integer("business_id").references(() => businessesTable.id, { onDelete: "set null" }),
    businessName: text("business_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    alertAttempts: integer("alert_attempts").notNull().default(0),
    alertNextAttemptAt: timestamp("alert_next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    alertSentAt: timestamp("alert_sent_at", { withTimezone: true }),
    alertLastError: text("alert_last_error"),
  },
  (table) => [
    uniqueIndex("operational_failures_event_key_unique").on(table.eventKey),
    index("operational_failures_alert_queue_idx").on(table.alertSentAt, table.alertNextAttemptAt),
    index("operational_failures_created_at_idx").on(table.createdAt),
  ],
);

export type OperationalFailure = typeof operationalFailuresTable.$inferSelect;
