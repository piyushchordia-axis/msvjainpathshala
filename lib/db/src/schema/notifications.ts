import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

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
    expo_token: text("expo_token").notNull(),
    platform: text("platform"),
    is_active: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => ({
    token_unique: uniqueIndex("device_push_tokens_token_unique").on(t.expo_token),
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
    expo_token: text("expo_token").notNull(),
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
    read_at: timestamp("read_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    // (user_id, created_at DESC) covers inbox list; subsumes old idx_notifications_user.
    user_created_idx: index("idx_notifications_user_created").on(t.user_id, t.created_at),
    user_read_idx: index("idx_notifications_user_read").on(t.user_id, t.read_at),
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
