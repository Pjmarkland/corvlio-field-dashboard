import {
  businessAdminEventsTable,
  businessesTable,
  db,
  firstClientChecklistTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";

export const FIRST_CLIENT_CHECKLIST_ITEMS = [
  { key: "business_details_reviewed", label: "Business details reviewed" },
  { key: "plan_assigned", label: "Plan assigned" },
  { key: "payment_confirmed", label: "Payment confirmed" },
  { key: "phone_line_provisioned", label: "Phone line provisioned" },
  { key: "test_call_done", label: "My test call done" },
  { key: "call_forwarding_verified", label: "Owner call forwarding set up and verified" },
  { key: "first_week_check_in_done", label: "First-week check-in done" },
] as const;

export type FirstClientChecklistKey = (typeof FIRST_CLIENT_CHECKLIST_ITEMS)[number]["key"];
export type FirstClientChecklistItem = {
  key: FirstClientChecklistKey;
  label: string;
  completed: boolean;
  completedAt: string | null;
};

export function isFirstClientChecklistKey(value: string): value is FirstClientChecklistKey {
  return FIRST_CLIENT_CHECKLIST_ITEMS.some((item) => item.key === value);
}

export async function getFirstClientChecklistItems(businessId: number): Promise<FirstClientChecklistItem[]> {
  const rows = await db
    .select({
      itemKey: firstClientChecklistTable.itemKey,
      completedAt: firstClientChecklistTable.completedAt,
    })
    .from(firstClientChecklistTable)
    .where(eq(firstClientChecklistTable.businessId, businessId));
  const records = new Map(rows.map((row) => [row.itemKey, row.completedAt]));
  return FIRST_CLIENT_CHECKLIST_ITEMS.map((item) => {
    const completedAt = records.get(item.key) ?? null;
    return {
      ...item,
      completed: completedAt !== null,
      completedAt: completedAt?.toISOString() ?? null,
    };
  });
}

export async function getFirstClientChecklistProgress(businessIds: number[]) {
  const progress = new Map(businessIds.map((businessId) => [businessId, 0]));
  if (businessIds.length === 0) return progress;
  const rows = await db
    .select({
      businessId: firstClientChecklistTable.businessId,
      itemKey: firstClientChecklistTable.itemKey,
    })
    .from(firstClientChecklistTable)
    .where(and(
      inArray(firstClientChecklistTable.businessId, businessIds),
      sql`${firstClientChecklistTable.completedAt} IS NOT NULL`,
    ));
  for (const row of rows) {
    if (isFirstClientChecklistKey(row.itemKey)) {
      progress.set(row.businessId, (progress.get(row.businessId) ?? 0) + 1);
    }
  }
  return progress;
}

export async function updateFirstClientChecklistItem(input: {
  businessId: number;
  itemKey: FirstClientChecklistKey;
  completed: boolean;
  actorUserId: string;
}): Promise<FirstClientChecklistItem | null> {
  const item = FIRST_CLIENT_CHECKLIST_ITEMS.find((candidate) => candidate.key === input.itemKey);
  if (!item) return null;

  const [business] = await db
    .select({
      id: businessesTable.id,
      isInternal: businessesTable.isInternal,
      isSample: businessesTable.isSample,
    })
    .from(businessesTable)
    .where(eq(businessesTable.id, input.businessId))
    .limit(1);
  if (!business || business.isInternal || business.isSample) return null;

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(542314, ${input.businessId})`);
    const [existing] = await tx
      .select()
      .from(firstClientChecklistTable)
      .where(and(
        eq(firstClientChecklistTable.businessId, input.businessId),
        eq(firstClientChecklistTable.itemKey, input.itemKey),
      ))
      .limit(1);
    const wasCompleted = existing?.completedAt != null;
    const nextCompletedAt = input.completed
      ? wasCompleted
        ? existing?.completedAt ?? null
        : new Date()
      : null;

    if (wasCompleted !== input.completed) {
      if (existing) {
        await tx.update(firstClientChecklistTable).set({
          completedAt: nextCompletedAt,
          completedByUserId: input.completed ? input.actorUserId : null,
          updatedAt: new Date(),
        }).where(eq(firstClientChecklistTable.id, existing.id));
      } else if (input.completed) {
        await tx.insert(firstClientChecklistTable).values({
          businessId: input.businessId,
          itemKey: input.itemKey,
          completedAt: nextCompletedAt,
          completedByUserId: input.actorUserId,
          updatedAt: new Date(),
        });
      }

      await tx.insert(businessAdminEventsTable).values({
        businessId: input.businessId,
        actorUserId: input.actorUserId,
        action: input.completed
          ? "first_client_checklist_item_completed"
          : "first_client_checklist_item_reopened",
        previousValue: existing?.completedAt?.toISOString() ?? "not completed",
        newValue: nextCompletedAt?.toISOString() ?? "not completed",
        reason: input.itemKey,
      });
    }

    return {
      key: item.key,
      label: item.label,
      completed: input.completed,
      completedAt: nextCompletedAt?.toISOString() ?? null,
    };
  });
}
