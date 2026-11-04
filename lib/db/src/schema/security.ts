import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const requestRateLimitBucketsTable = pgTable(
  "request_rate_limit_buckets",
  {
    bucketKey: text("bucket_key").primaryKey(),
    count: integer("count").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("request_rate_limit_buckets_reset_idx").on(table.resetAt)],
);

export const adminAuditLogTable = pgTable(
  "admin_audit_log",
  {
    id: serial("id").primaryKey(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    route: text("route").notNull(),
    businessId: integer("business_id"),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("admin_audit_log_created_idx").on(table.createdAt),
    index("admin_audit_log_actor_idx").on(table.actorUserId, table.createdAt),
  ],
);

export const retellWebhookEventsTable = pgTable(
  "retell_webhook_events",
  {
    id: serial("id").primaryKey(),
    callId: text("call_id").notNull(),
    eventType: text("event_type").notNull(),
    state: text("state").notNull().default("processing"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("retell_webhook_events_call_event_unique").on(table.callId, table.eventType),
    index("retell_webhook_events_started_idx").on(table.startedAt),
  ],
);

