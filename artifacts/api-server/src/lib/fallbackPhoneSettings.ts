import { eq } from "drizzle-orm";
import { db, fallbackPhoneSettingsTable } from "@workspace/db";

export const DEFAULT_FALLBACK_PHONE_NUMBER = "+18634463029";
const SETTINGS_ROW_ID = 1;

export async function getDefaultFallbackPhoneNumber(): Promise<string> {
  const [settings] = await db
    .select({ phoneNumber: fallbackPhoneSettingsTable.defaultFallbackPhoneNumber })
    .from(fallbackPhoneSettingsTable)
    .where(eq(fallbackPhoneSettingsTable.id, SETTINGS_ROW_ID))
    .limit(1);

  return settings?.phoneNumber ?? DEFAULT_FALLBACK_PHONE_NUMBER;
}

export async function saveDefaultFallbackPhoneNumber(phoneNumber: string): Promise<string> {
  const [settings] = await db
    .insert(fallbackPhoneSettingsTable)
    .values({
      id: SETTINGS_ROW_ID,
      defaultFallbackPhoneNumber: phoneNumber,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: fallbackPhoneSettingsTable.id,
      set: {
        defaultFallbackPhoneNumber: phoneNumber,
        updatedAt: new Date(),
      },
    })
    .returning({ phoneNumber: fallbackPhoneSettingsTable.defaultFallbackPhoneNumber });

  if (!settings) throw new Error("Default fallback phone number was not saved");
  return settings.phoneNumber;
}
