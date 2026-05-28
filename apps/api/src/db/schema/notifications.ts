/** Notifications + SMS provider audit logs (SPEC §5.18). */

import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { notificationChannelEnum, notificationStatusEnum } from './enums';
import { users } from './identity';
import { notices } from './notices';

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // e.g. 'attendance_marked', 'niyam_punya_awarded', 'tier_upgraded'.
  kind: text('kind').notNull(),
  title_en: text('title_en').notNull(),
  title_hi: text('title_hi').notNull(),
  body_en: text('body_en').notNull(),
  body_hi: text('body_hi').notNull(),
  // Deep-link payload — shape varies by `kind`; tightened by DTO at write time.
  data: jsonb('data'),
  is_read: boolean('is_read').notNull().default(false),
  channel: notificationChannelEnum('channel').notNull(),
  status: notificationStatusEnum('status').notNull().default('pending'),
  source_entity_kind: text('source_entity_kind'),
  source_entity_id: uuid('source_entity_id'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sms_logs = pgTable('sms_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  notice_id: uuid('notice_id').references(() => notices.id, { onDelete: 'set null' }),
  phone: varchar('phone', { length: 15 }).notNull(),
  body: text('body').notNull(),
  provider_message_id: text('provider_message_id'),
  status: text('status'),
  cost_paise: integer('cost_paise'),
  sent_at: timestamp('sent_at', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type SmsLog = typeof sms_logs.$inferSelect;
export type NewSmsLog = typeof sms_logs.$inferInsert;
