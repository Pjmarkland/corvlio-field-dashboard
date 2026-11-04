import { db, usageAlertSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const DEFAULT_USAGE_ALERT_SETTINGS = {
  dailyTotalCallMinutes: 500,
  monthlyTotalCallMinutes: 8000,
  dailyPerBusinessCallMinutes: 120,
  monthlyPerBusinessCallMinutes: 1500,
  dailyProvisionedNumbers: 3,
  monthlyProvisionedNumbers: 20,
} as const;

export type UsageAlertSettingsInput = {
  dailyTotalCallMinutes: number;
  monthlyTotalCallMinutes: number;
  dailyPerBusinessCallMinutes: number;
  monthlyPerBusinessCallMinutes: number;
  dailyProvisionedNumbers: number;
  monthlyProvisionedNumbers: number;
};

export async function getUsageAlertSettings() {
  const [record] = await db.select().from(usageAlertSettingsTable)
    .where(eq(usageAlertSettingsTable.id, 1))
    .limit(1);
  return {
    ...DEFAULT_USAGE_ALERT_SETTINGS,
    ...(record ? {
      dailyTotalCallMinutes: record.dailyTotalCallMinutes,
      monthlyTotalCallMinutes: record.monthlyTotalCallMinutes,
      dailyPerBusinessCallMinutes: record.dailyPerBusinessCallMinutes,
      monthlyPerBusinessCallMinutes: record.monthlyPerBusinessCallMinutes,
      dailyProvisionedNumbers: record.dailyProvisionedNumbers,
      monthlyProvisionedNumbers: record.monthlyProvisionedNumbers,
    } : {}),
    updatedAt: record?.updatedAt.toISOString() ?? null,
  };
}

export async function saveUsageAlertSettings(
  input: UsageAlertSettingsInput,
  updatedByUserId: string,
) {
  const [record] = await db.insert(usageAlertSettingsTable).values({
    id: 1,
    ...input,
    updatedByUserId,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: usageAlertSettingsTable.id,
    set: {
      ...input,
      updatedByUserId,
      updatedAt: new Date(),
    },
  }).returning();

  return {
    dailyTotalCallMinutes: record.dailyTotalCallMinutes,
    monthlyTotalCallMinutes: record.monthlyTotalCallMinutes,
    dailyPerBusinessCallMinutes: record.dailyPerBusinessCallMinutes,
    monthlyPerBusinessCallMinutes: record.monthlyPerBusinessCallMinutes,
    dailyProvisionedNumbers: record.dailyProvisionedNumbers,
    monthlyProvisionedNumbers: record.monthlyProvisionedNumbers,
    updatedAt: record.updatedAt.toISOString(),
  };
}
