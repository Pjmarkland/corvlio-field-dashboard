import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";
import { leadsTable } from "./leads";

export const ownerSmsMessagesTable = pgTable(
  "owner_sms_messages",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id").references(() => businessesTable.id, { onDelete: "cascade" }),
    leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "cascade" }),
    category: text("category", { enum: ["lead_alert", "test", "help_reply"] }).notNull(),
    recipientPhone: text("recipient_phone").notNull(),
    adminEmail: text("admin_email"),
    requestId: text("request_id"),
    status: text("status", { enum: ["queued", "sent", "delivered", "failed", "undelivered"] }).notNull().default("queued"),
    twilioMessageSid: text("twilio_message_sid"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("owner_sms_category_check", sql`${table.category} IN ('lead_alert', 'test', 'help_reply')`),
    check("owner_sms_status_check", sql`${table.status} IN ('queued', 'sent', 'delivered', 'failed', 'undelivered')`),
    index("owner_sms_status_created_idx").on(table.status, table.createdAt),
    uniqueIndex("owner_sms_request_id_unique").on(table.requestId),
    uniqueIndex("owner_sms_twilio_sid_unique").on(table.twilioMessageSid),
    uniqueIndex("owner_sms_business_lead_category_unique").on(table.businessId, table.leadId, table.category),
  ],
);

export type OwnerSmsMessage = typeof ownerSmsMessagesTable.$inferSelect;
export type NewOwnerSmsMessage = typeof ownerSmsMessagesTable.$inferInsert;
