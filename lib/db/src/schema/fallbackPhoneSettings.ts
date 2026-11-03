import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const fallbackPhoneSettingsTable = pgTable("fallback_phone_settings", {
  id: integer("id").primaryKey().default(1),
  defaultFallbackPhoneNumber: text("default_fallback_phone_number").notNull().default("+18634463029"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFallbackPhoneSettingsSchema = createInsertSchema(fallbackPhoneSettingsTable)
  .omit({ updatedAt: true });
export type InsertFallbackPhoneSettings = z.infer<typeof insertFallbackPhoneSettingsSchema>;
export type FallbackPhoneSettings = typeof fallbackPhoneSettingsTable.$inferSelect;
