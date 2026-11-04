import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const businessAdminEventsTable = pgTable("business_admin_events", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  actorUserId: text("actor_user_id").notNull(),
  action: text("action").notNull(),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("business_admin_events_business_created_idx").on(table.businessId, table.createdAt),
]);

export type BusinessAdminEvent = typeof businessAdminEventsTable.$inferSelect;
