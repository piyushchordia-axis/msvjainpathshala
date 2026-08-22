import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { timestamps } from "./_helpers";
import { notificationKindEnum } from "./enums";
import { users } from "./identity";

/** Registered Expo push tokens per user/device (for push delivery). */
export const device_push_tokens = pgTable(
  "device_push_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // DB-9 (review 2026-08): was a plain uniqueIndex, which Postgres will not
    // accept as an ON DELETE target for a foreign key (push_receipts.expo_token
    // below) — needs a real UNIQUE CONSTRAINT, not just a unique index.
    expo_token: text("expo_token").notNull().unique("device_push_tokens_token_unique"),
    platform: text("platform"),
    is_active: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => ({
    user_idx: index("idx_device_push_tokens_user").on(t.user_id),
  }),
);

/**
 * Expo 'ok' ticket ids awaiting receipt sweep (DeviceNotRegistered often
 * appears only on the async receipt, not the immediate ticket).
 */
export const push_receipts = pgTable(
  "push_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticket_id: text("ticket_id").notNull(),
    // DB-9: real FK against device_push_tokens' unique expo_token index, so a
    // sweep for a token whose row is gone is caught rather than silently
    // going nowhere. device_push_tokens rows are soft-deactivated
    // (is_active=false), never hard-deleted, so this FK never blocks a
    // legitimate deactivation.
    expo_token: text("expo_token")
      .notNull()
      .references(() => device_push_tokens.expo_token, { onDelete: "cascade" }),
    checked_at: timestamp("checked_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    ticket_unique: uniqueIndex("push_receipts_ticket_id_unique").on(t.ticket_id),
    unchecked_idx: index("idx_push_receipts_unchecked").on(t.checked_at, t.created_at),
  }),
);

/** In-app notification inbox (also the fallback when push isn't delivered). */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: notificationKindEnum("kind").notNull().default("general"),
    title_en: text("title_en").notNull(),
    title_hi: text("title_hi").notNull(),
    body_en: text("body_en").notNull(),
    body_hi: text("body_hi").notNull(),
    // DB-1 / X-9 (review 2026-08): the durable row previously carried no
    // reference to the thing it's about, so it could never deep-link even in
    // principle. Mirrors opts.data already accepted (and merged into the push
    // payload only) by notifyUsers.
    data: jsonb("data").$type<Record<string, unknown>>(),
    read_at: timestamp("read_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    // Keyset pagination (FIX #10): id breaks ties when notifyUsers inserts a
    // batch. DESC to match migration 0046's actual index direction (DB-6) —
    // backward-scan made runtime correct either way, but a mismatched
    // declaration makes drizzle-kit generate propose a spurious
    // drop-and-recreate of the hottest index in the app.
    user_created_id_idx: index("idx_notifications_user_created_id").on(
      t.user_id,
      t.created_at.desc(),
      t.id.desc(),
    ),
    user_read_idx: index("idx_notifications_user_read").on(t.user_id, t.read_at),
    // DB-2: retention.ts's prune query filters read_at IS NOT NULL and sorts
    // by created_at — this partial index matches that shape exactly, instead
    // of seq-scanning + sorting the whole table every 5000-row batch.
    retention_prune_idx: index("idx_notifications_retention_prune")
      .on(t.created_at)
      .where(sql`${t.read_at} IS NOT NULL`),
  }),
);

/** Public contact / enquiry submissions (unauthenticated public forms). */
export const enquiries = pgTable(
  "enquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull().default("contact"), // 'contact' | 'enquire' | 'donate'
    name: text("name").notNull(),
    phone: varchar("phone", { length: 15 }),
    email: varchar("email", { length: 255 }),
    subject: text("subject"),
    message: text("message").notNull(),
    city: text("city"),
    status: text("status").notNull().default("new"), // 'new' | 'in_review' | 'closed'
    handled_by: uuid("handled_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => ({
    status_idx: index("idx_enquiries_status").on(t.status),
  }),
);

export type DevicePushToken = typeof device_push_tokens.$inferSelect;
export type PushReceipt = typeof push_receipts.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Enquiry = typeof enquiries.$inferSelect;
