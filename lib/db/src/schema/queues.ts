import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "./_helpers";

/** Dev/ops snapshot of background queue depth (no Redis required). */
export const queue_stats = pgTable("queue_stats", {
  queue_name: text("queue_name").primaryKey(),
  waiting: integer("waiting").notNull().default(0),
  active: integer("active").notNull().default(0),
  completed_24h: integer("completed_24h").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const queue_dlq_jobs = pgTable("queue_dlq_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  queue_name: text("queue_name").notNull(),
  job_id: text("job_id").notNull(),
  payload: jsonb("payload").notNull().default({}),
  error_message: text("error_message"),
  failed_at: timestamp("failed_at", { withTimezone: true }).notNull().defaultNow(),
  replayed_at: timestamp("replayed_at", { withTimezone: true }),
  ...timestamps(),
});
