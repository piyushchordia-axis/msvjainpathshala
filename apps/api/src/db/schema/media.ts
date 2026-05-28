/**
 * Media assets (SPEC §5.21).
 *
 * Cyclic-FK note: `media_assets.owner_user_id → users.id` carries the
 * authoritative constraint; the reverse pointer (`users.profile_photo_asset_id`)
 * is left unconstrained at the DB level. See `identity.ts` for the rationale.
 */

import { bigint, boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { softDelete, timestamps } from './_helpers';
import { mediaKindEnum, mediaStatusEnum } from './enums';
import { users } from './identity';

export const media_assets = pgTable('media_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: mediaKindEnum('kind').notNull(),
  owner_user_id: uuid('owner_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  s3_bucket: text('s3_bucket').notNull(),
  s3_key: text('s3_key').notNull(),
  mime_type: text('mime_type').notNull(),
  size_bytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  checksum_sha256: text('checksum_sha256').notNull(),
  width: integer('width'),
  height: integer('height'),
  duration_seconds: integer('duration_seconds'),
  thumbnail_s3_key: text('thumbnail_s3_key'),
  status: mediaStatusEnum('status').notNull(),
  exif_stripped: boolean('exif_stripped').notNull().default(false),
  virus_scan_status: text('virus_scan_status'),
  processed_at: timestamp('processed_at', { withTimezone: true }),
  ...softDelete(),
  ...timestamps(),
});

export type MediaAsset = typeof media_assets.$inferSelect;
export type NewMediaAsset = typeof media_assets.$inferInsert;
