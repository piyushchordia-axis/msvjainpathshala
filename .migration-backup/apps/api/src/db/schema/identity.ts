/**
 * Identity — users, sessions, OTP attempts, refresh-token families, device tokens.
 *
 * (SPEC §5.2 + Step 4 prompt extensions for the auth-adjacent tables Step 5
 * will consume.)
 *
 * `users.profile_photo_asset_id` is a plain uuid column WITHOUT a FK
 * constraint, to break the cyclic FK with `media_assets.owner_user_id`. The
 * owner-side constraint on media_assets is the authoritative one; losing a
 * profile-photo asset is a soft data integrity concern handled in service code.
 *
 * Phone OTP + refresh-token-family tables are defined here so Step 5 can land
 * the auth module without further schema changes (per the approved plan,
 * Decision 3).
 */

import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { softDelete, timestamps } from './_helpers';
import { genderEnum, languageEnum, roleEnum } from './enums';
import { cities, states } from './geography';

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: varchar('phone', { length: 15 }).notNull(),
    email: varchar('email', { length: 255 }),
    role: roleEnum('role').notNull(),
    full_name: text('full_name').notNull(),
    gender: genderEnum('gender'),
    preferred_language: languageEnum('preferred_language').notNull().default('en'),
    // No FK — see file-level note about the cyclic relationship with media_assets.
    profile_photo_asset_id: uuid('profile_photo_asset_id'),
    state_id: uuid('state_id').references(() => states.id, { onDelete: 'restrict' }),
    city_id: uuid('city_id').references(() => cities.id, { onDelete: 'restrict' }),
    // Sanchalak's primary centre; nullable for other roles. FK declared in centres.ts
    // via a separate alter — kept as plain uuid here to avoid a forward-reference cycle.
    centre_id_default: uuid('centre_id_default'),
    is_active: boolean('is_active').notNull().default(true),
    last_login_at: timestamp('last_login_at', { withTimezone: true }),
    // CLAUDE.md Q6 — blanket per-parent gallery visibility opt-in covering all children.
    gallery_visibility_opt_in: boolean('gallery_visibility_opt_in').notNull().default(false),
    // Per-user notification preferences (SPEC §5.18 / Step 12). JSONB so we can
    // add new channels without a migration; shape validated against the
    // `notificationPreferencesSchema` in `@jp/shared` at write time. Default
    // value matches the schema: every channel ON.
    notification_preferences: jsonb('notification_preferences')
      .$type<{ push: boolean; sms: boolean; email: boolean; in_app: boolean }>()
      .notNull()
      .default({ push: true, sms: true, email: true, in_app: true }),
    ...softDelete(),
    ...timestamps(),
    // Self-referencing audit cols (created_by / updated_by → users.id).
    created_by: uuid('created_by').references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
    updated_by: uuid('updated_by').references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    uniquePhone: uniqueIndex('users_phone_unique').on(t.phone),
  }),
);

// ---------------------------------------------------------------------------
// device_sessions
// ---------------------------------------------------------------------------

export const device_sessions = pgTable('device_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  device_id: text('device_id').notNull(),
  platform: text('platform').notNull(), // 'ios' | 'android' | 'web' — kept as text per spec
  refresh_token_hash: text('refresh_token_hash').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  last_used_at: timestamp('last_used_at', { withTimezone: true }),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// device_tokens (push)
// ---------------------------------------------------------------------------

export const device_tokens = pgTable(
  'device_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    token: text('token').notNull(),
    // Optional client-side device_id — lets a logout invalidate the matching
    // push token without the client having to remember its own row id.
    device_id: text('device_id'),
    last_seen_at: timestamp('last_seen_at', { withTimezone: true }),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    uniqueToken: uniqueIndex('device_tokens_token_unique').on(t.token),
  }),
);

// ---------------------------------------------------------------------------
// phone_otp_attempts (Step 4 — Decision 3)
// ---------------------------------------------------------------------------

/**
 * Tracks OTP send/verify activity per phone for audit + abuse detection.
 * Hot rate limits live in Redis (SPEC §7.10); this table is the durable
 * audit / forensics record. Step 5 inserts a row per OTP request.
 */
export const phone_otp_attempts = pgTable('phone_otp_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: varchar('phone', { length: 15 }).notNull(),
  ip: varchar('ip', { length: 45 }),
  // argon2id hash of the 6-digit OTP; never the plaintext (CLAUDE.md security rules).
  otp_hash: text('otp_hash').notNull(),
  // How many wrong verify attempts so far.
  attempts_count: integer('attempts_count').notNull().default(0),
  last_attempt_at: timestamp('last_attempt_at', { withTimezone: true }),
  locked_until: timestamp('locked_until', { withTimezone: true }),
  succeeded_at: timestamp('succeeded_at', { withTimezone: true }),
  // 5-minute TTL — used by the daily auth.session.cleanup cron to purge.
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// refresh_token_families (Step 4 — Decision 3)
// ---------------------------------------------------------------------------

/**
 * Refresh-token reuse detection (SPEC §7.3). One row per issued family;
 * when a refresh token is rotated, the next-link is recorded. If a token
 * from earlier in the chain is presented again, the whole family is
 * revoked (`revoked_at` set, with `revoked_reason='reuse_detected'`).
 */
export const refresh_token_families = pgTable('refresh_token_families', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  device_session_id: uuid('device_session_id')
    .notNull()
    .references(() => device_sessions.id, { onDelete: 'cascade' }),
  // argon2id hash of the most recent token in the family.
  current_token_hash: text('current_token_hash').notNull(),
  // For chain reconstruction during reuse detection.
  rotation_count: integer('rotation_count').notNull().default(0),
  last_rotated_at: timestamp('last_rotated_at', { withTimezone: true }),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  revoked_reason: text('revoked_reason'),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// Inferred TS types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type DeviceSession = typeof device_sessions.$inferSelect;
export type NewDeviceSession = typeof device_sessions.$inferInsert;
export type DeviceToken = typeof device_tokens.$inferSelect;
export type NewDeviceToken = typeof device_tokens.$inferInsert;
export type PhoneOtpAttempt = typeof phone_otp_attempts.$inferSelect;
export type NewPhoneOtpAttempt = typeof phone_otp_attempts.$inferInsert;
export type RefreshTokenFamily = typeof refresh_token_families.$inferSelect;
export type NewRefreshTokenFamily = typeof refresh_token_families.$inferInsert;
