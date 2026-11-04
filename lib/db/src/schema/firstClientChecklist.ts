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

export const firstClientChecklistTable = pgTable(
  "first_client_checklist",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedByUserId: text("completed_by_user_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("first_client_checklist_business_item_unique").on(table.businessId, table.itemKey),
    index("first_client_checklist_business_idx").on(table.businessId),
  ],
);

export type FirstClientChecklistRecord = typeof firstClientChecklistTable.$inferSelect;
