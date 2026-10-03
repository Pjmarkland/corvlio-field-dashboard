import { foreignKey, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";

// Separate from leads/call activity: demos never affect customer statistics.
export const ownerDemoCallsTable = pgTable("owner_demo_calls", {
  id: uuid("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  confirmedNumber: text("confirmed_number").notNull(),
  // Match the existing development UNIQUE constraint created by onboarding's migration.
  callId: text("call_id").unique("owner_demo_calls_call_id_key"),
  status: text("status").notNull().default("reserved"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: "owner_demo_calls_business_id_fkey",
    columns: [table.businessId],
    foreignColumns: [businessesTable.id],
  }).onDelete("cascade"),
]);