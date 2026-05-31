/** Library items + per-access audit log (SPEC §5.16). */

import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { softDelete, timestamps } from './_helpers';
import { ageGroupEnum, languageEnum, libraryAccessTierEnum, libraryContentTypeEnum } from './enums';
import { cities } from './geography';
import { users } from './identity';

export const library_items = pgTable('library_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  content_type: libraryContentTypeEnum('content_type').notNull(),
  title_en: text('title_en').notNull(),
  title_hi: text('title_hi').notNull(),
  description_en: text('description_en'),
  description_hi: text('description_hi'),
  asset_id: uuid('asset_id'),
  // Q7: YouTube / Vimeo only for type='video'. Service validates the URL.
  embed_url: text('embed_url'),
  tags: text('tags').array(),
  age_groups: ageGroupEnum('age_groups').array(),
  languages: languageEnum('languages').array(),
  access_tier: libraryAccessTierEnum('access_tier').notNull(),
  msv_only: boolean('msv_only').notNull().default(false),
  uploaded_by_user_id: uuid('uploaded_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  city_id: uuid('city_id').references(() => cities.id, { onDelete: 'restrict' }),
  ...softDelete(),
  ...timestamps(),
});

export const library_access_logs = pgTable('library_access_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  item_id: uuid('item_id')
    .notNull()
    .references(() => library_items.id, { onDelete: 'cascade' }),
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(), // 'view' | 'download'
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type LibraryItem = typeof library_items.$inferSelect;
export type NewLibraryItem = typeof library_items.$inferInsert;
export type LibraryAccessLog = typeof library_access_logs.$inferSelect;
export type NewLibraryAccessLog = typeof library_access_logs.$inferInsert;
