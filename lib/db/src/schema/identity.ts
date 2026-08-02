import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { softDelete, timestamps } from "./_helpers";
import { genderEnum, languageEnum, roleEnum } from "./enums";
import { cities, states } from "./geography";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: varchar("phone", { length: 15 }).notNull(),
    email: varchar("email", { length: 255 }),
    role: roleEnum("role").notNull(),
    full_name: text("full_name").notNull(),
    gender: genderEnum("gender"),
    preferred_language: languageEnum("preferred_language").notNull().default("en"),
    state_id: uuid("state_id").references(() => states.id, { onDelete: "restrict" }),
    city_id: uuid("city_id").references(() => cities.id, { onDelete: "restrict" }),
    centre_id_default: uuid("centre_id_default"),
    is_active: boolean("is_active").notNull().default(true),
    last_login_at: timestamp("last_login_at", { withTimezone: true }),
    gallery_visibility_opt_in: boolean("gallery_visibility_opt_in").notNull().default(false),
    /** Per-kind opt-outs; honour before enqueueing pushes (AT31). */
    notification_preferences: jsonb("notification_preferences").notNull().default({}),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    uniquePhone: uniqueIndex("users_phone_unique").on(t.phone),
    city_idx: index("idx_users_city").on(t.city_id),
    state_idx: index("idx_users_state").on(t.state_id),
    role_idx: index("idx_users_role").on(t.role),
  }),
);

export const device_sessions = pgTable(
  "device_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    device_id: text("device_id").notNull(),
    platform: text("platform").notNull(),
    refresh_token_hash: text("refresh_token_hash").notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    user_idx: index("idx_device_sessions_user").on(t.user_id),
  }),
);

export const otp_codes = pgTable(
  "otp_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: varchar("phone", { length: 15 }).notNull(),
    otp_token: text("otp_token").notNull(),
    // Exactly one of these carries the challenge:
    //  - code_hash: we minted the code and verify it locally (mock/MSG91/generic).
    //  - session_id: the provider minted + delivered the code and verifies it for
    //    us (2Factor AUTOGEN); we never see the code at all.
    code_hash: text("code_hash"),
    session_id: text("session_id"),
    attempts_count: integer("attempts_count").notNull().default(0),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumed_at: timestamp("consumed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    uniqueToken: uniqueIndex("otp_codes_token_unique").on(t.otp_token),
    phone_idx: index("idx_otp_codes_phone").on(t.phone),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type DeviceSession = typeof device_sessions.$inferSelect;
export type NewDeviceSession = typeof device_sessions.$inferInsert;
export type OtpCode = typeof otp_codes.$inferSelect;
export type NewOtpCode = typeof otp_codes.$inferInsert;

// Satisfy the linter for the AnyPgColumn import retained for parity.
export type _IdentityColumn = AnyPgColumn;
