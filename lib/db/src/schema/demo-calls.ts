import { integer, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";

// Separate from leads/call activity: demos never affect customer statistics.
export const ownerDemoCallsTable = pgTable("owner_demo_calls", {
  id: uuid("id").primaryKey(),
  businessId: integer("business_id").notNull().references(() => businessesTable.id, { onDelete: "cascade" }),
  confirmedNumber: text("confirmed_number").notNull(),
  callId: text("call_id"),
  status: text("status").notNull().default("reserved"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("owner_demo_call_id_unique").on(table.callId)]);