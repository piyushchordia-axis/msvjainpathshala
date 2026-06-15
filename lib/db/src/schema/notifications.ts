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
    title_hi: text("title_hi"),
    body_en: text("body_en").notNull(),
    body_hi: text("body_hi"),
    read_at: timestamp("read_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    user_idx: index("idx_notifications_user").on(t.user_id),
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
export type Notification = typeof notifications.$inferSelect;
export type Enquiry = typeof enquiries.$inferSelect;
