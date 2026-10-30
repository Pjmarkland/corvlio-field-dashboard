import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

export const emailHealthAttemptsTable = pgTable("email_health_attempts", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  actorUserId: text("actor_user_id"),
  recipient: text("recipient"),
  status: text("status").notNull(),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, t => [index("email_health_attempts_finished_idx").on(t.finishedAt)]);
