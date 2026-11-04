import { integer, pgTable, timestamp, text } from "drizzle-orm/pg-core";

export const usageAlertSettingsTable = pgTable("usage_alert_settings", {
  id: integer("id").primaryKey(),
  dailyTotalCallMinutes: integer("daily_total_call_minutes").notNull().default(500),
  monthlyTotalCallMinutes: integer("monthly_total_call_minutes").notNull().default(8000),
  dailyPerBusinessCallMinutes: integer("daily_per_business_call_minutes").notNull().default(120),
  monthlyPerBusinessCallMinutes: integer("monthly_per_business_call_minutes").notNull().default(1500),
  dailyProvisionedNumbers: integer("daily_provisioned_numbers").notNull().default(3),
  monthlyProvisionedNumbers: integer("monthly_provisioned_numbers").notNull().default(20),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: text("updated_by_user_id"),
});

export type UsageAlertSettingsRecord = typeof usageAlertSettingsTable.$inferSelect;
