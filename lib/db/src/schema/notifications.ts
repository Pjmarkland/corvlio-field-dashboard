import {
  boolean,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const notificationDevicesTable = pgTable(
  "notification_devices",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    businessId: text("business_id").notNull(),
    platform: text("platform").notNull(),
    apnsEnvironment: text("apns_environment", {enum:["sandbox","production"]}),
    token: text("token").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("notification_devices_token_unique").on(table.token),
  ],
);

export const notificationPollStateTable = pgTable("notification_poll_state", {
  businessId: text("business_id").primaryKey(),
  initializedAt: timestamp("initialized_at", { withTimezone: true }),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  lastSucceededAt: timestamp("last_succeeded_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationSeenLeadsTable = pgTable(
  "notification_seen_leads",
  {
    businessId: text("business_id").notNull(),
    leadId: text("lead_id").notNull(),
    baseline: boolean("baseline").notNull().default(false),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.businessId, table.leadId] }),
  ],
);

export const notificationEventsTable = pgTable(
  "notification_events",
  {
    id: serial("id").primaryKey(),
    businessId: text("business_id").notNull(),
    leadId: text("lead_id").notNull(),
    title: text("title").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    emailStatus: text("email_status").notNull().default("skipped"),
    emailAttempts: integer("email_attempts").notNull().default(0),
    emailNextAttemptAt: timestamp("email_next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    emailLastError: text("email_last_error"),
    body: text("body").notNull(),
    deepLink: text("deep_link").notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("notification_events_business_lead_unique").on(
      table.businessId,
      table.leadId,
    ),
  ],
);

export const notificationDeliveryAttemptsTable = pgTable("notification_delivery_attempts", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => notificationEventsTable.id, { onDelete: "cascade" }),
  deviceId: integer("device_id").notNull().references(() => notificationDevicesTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  outcome: text("outcome").notNull(),
  providerMessageId: text("provider_message_id"),
  error: text("error"),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationPollerLeasesTable = pgTable("notification_poller_leases", {
  name: text("name").primaryKey(),
  ownerId: text("owner_id").notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationDevice = typeof notificationDevicesTable.$inferSelect;
export type NotificationEvent = typeof notificationEventsTable.$inferSelect;