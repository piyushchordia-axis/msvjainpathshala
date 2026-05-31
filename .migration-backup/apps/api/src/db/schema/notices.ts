/** Notices + per-user read receipts (SPEC §5.10). */

import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { softDelete, timestamps } from './_helpers';
import { batches, centres } from './centres';
import { noticeAudienceEnum } from './enums';
import { cities } from './geography';
import { users } from './identity';

export const notices = pgTable('notices', {
  id: uuid('id').primaryKey().defaultRandom(),
  scope: noticeAudienceEnum('scope').notNull(),
  city_id: uuid('city_id')
    .notNull()
    .references(() => cities.id, { onDelete: 'restrict' }),
  centre_id: uuid('centre_id').references(() => centres.id, { onDelete: 'set null' }),
  batch_id: uuid('batch_id').references(() => batches.id, { onDelete: 'set null' }),
  msv_only: boolean('msv_only').notNull().default(false),
  content_en: text('content_en').notNull(),
  content_hi: text('content_hi').notNull(),
  attachments: jsonb('attachments'),
  pinned: boolean('pinned').notNull().default(false),
  scheduled_for: timestamp('scheduled_for', { withTimezone: true }),
  published_at: timestamp('published_at', { withTimezone: true }),
  is_public: boolean('is_public').notNull().default(false),
  // Critical notices trigger an SMS fallback if push fails (SPEC §8.7).
  is_critical: boolean('is_critical').notNull().default(false),
  send_sms: boolean('send_sms').notNull().default(false),
  created_by_user_id: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  ...softDelete(),
  ...timestamps(),
});

export const notice_reads = pgTable(
  'notice_reads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notice_id: uuid('notice_id')
      .notNull()
      .references(() => notices.id, { onDelete: 'cascade' }),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    read_at: timestamp('read_at', { withTimezone: true }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueNoticeUser: uniqueIndex('notice_reads_notice_user_unique').on(t.notice_id, t.user_id),
  }),
);

export type Notice = typeof notices.$inferSelect;
export type NewNotice = typeof notices.$inferInsert;
export type NoticeRead = typeof notice_reads.$inferSelect;
export type NewNoticeRead = typeof notice_reads.$inferInsert;
