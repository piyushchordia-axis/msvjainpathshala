import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { ULID_RE } from "./attendance";
import { softDelete, timestamps } from "./_helpers";
import {
  shivirAttendanceModeEnum,
  shivirRegistrationStatusEnum,
  shivirScanKindEnum,
} from "./enums";
import { cities, states } from "./geography";
import { students } from "./students";
import { users } from "./identity";

export const shivir_events = pgTable(
  "shivir_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Bilingual per CLAUDE.md. `_hi` is nullable on purpose: requiring Devanagari
     * at create time would block a city_admin who has the dates but not yet the
     * translation, so clients render `hi ? (name_hi ?? name_en) : name_en`.
     */
    name_en: text("name_en").notNull(),
    name_hi: text("name_hi"),
    description_en: text("description_en"),
    description_hi: text("description_hi"),
    state_id: uuid("state_id").references(() => states.id, { onDelete: "set null" }),
    city_id: uuid("city_id")
      .notNull()
      .references(() => cities.id, { onDelete: "restrict" }),
    start_date: date("start_date").notNull(),
    end_date: date("end_date").notNull(),
    location_text: text("location_text"),
    capacity: integer("capacity"),
    contact_info: text("contact_info"),
    attendance_mode: shivirAttendanceModeEnum("attendance_mode").notNull().default("present_only"),
    msv_only: boolean("msv_only").notNull().default(false),
    is_published: boolean("is_published").notNull().default(true),
    /**
     * When the "new shivir" announcement went out — set once, ever.
     *
     * The announcement is an unbounded fan-out to every parent in the city, so
     * it must fire exactly once per shivir. Without this an admin who publishes,
     * spots a typo, unpublishes and republishes notifies the whole city twice —
     * and a retried queue job does it again.
     */
    announced_at: timestamp("announced_at", { withTimezone: true }),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    city_idx: index("idx_shivir_events_city").on(t.city_id),
    state_idx: index("idx_shivir_events_state").on(t.state_id),
    date_range_check: check(
      "shivir_events_end_gte_start",
      sql`${t.end_date} >= ${t.start_date}`,
    ),
  }),
);

export const shivir_registrations = pgTable(
  "shivir_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shivir_id: uuid("shivir_id")
      .notNull()
      .references(() => shivir_events.id, { onDelete: "cascade" }),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    status: shivirRegistrationStatusEnum("status").notNull().default("registered"),
    /** The acting parent or admin — a student is never their own registrar. */
    registered_by_user_id: uuid("registered_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    registered_at: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
    cancelled_at: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    shivir_idx: index("idx_shivir_registrations_shivir").on(t.shivir_id),
    student_idx: index("idx_shivir_registrations_student").on(t.student_id),
    /**
     * One row per (shivir, student) for all time. Cancelling flips `status`, so a
     * parent who cancels and re-registers reuses this row rather than stacking
     * duplicates — each of which would otherwise count against capacity.
     */
    shivir_student_unique: uniqueIndex("shivir_registrations_shivir_student_uq").on(
      t.shivir_id,
      t.student_id,
    ),
  }),
);

export const shivir_volunteers = pgTable(
  "shivir_volunteers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shivir_id: uuid("shivir_id")
      .notNull()
      .references(() => shivir_events.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role_label: text("role_label"),
    assigned_by: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    assigned_at: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Revocation is a timestamp, not a delete: scans a volunteer recorded still
     * reference them, and an audit has to answer "who could act, and when".
     */
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    shivir_idx: index("idx_shivir_volunteers_shivir").on(t.shivir_id),
    user_idx: index("idx_shivir_volunteers_user").on(t.user_id),
    /**
     * Partial: only one LIVE assignment per (shivir, user), while re-assigning
     * someone after a revoke stays possible and keeps the revoked row on record.
     */
    active_unique: uniqueIndex("shivir_volunteers_active_shivir_user_uq")
      .on(t.shivir_id, t.user_id)
      .where(sql`${t.revoked_at} is null`),
  }),
);

// A timed session within a shivir (volunteers scan attendance against it).
export const shivir_sessions = pgTable(
  "shivir_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shivir_id: uuid("shivir_id")
      .notNull()
      .references(() => shivir_events.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /**
     * SPEC 5.11. Without day_number and times, two sessions on the same date are
     * indistinguishable to a volunteer choosing one on the scanner screen.
     */
    day_number: integer("day_number"),
    session_date: date("session_date").notNull(),
    start_time: time("start_time"),
    end_time: time("end_time"),
    attendance_mode: shivirAttendanceModeEnum("attendance_mode").notNull().default("present_only"),
    ...timestamps(),
  },
  (t) => ({
    shivir_idx: index("idx_shivir_sessions_shivir").on(t.shivir_id),
    shivir_day_unique: uniqueIndex("shivir_sessions_shivir_day_uq")
      .on(t.shivir_id, t.day_number)
      .where(sql`${t.day_number} is not null`),
  }),
);

// One QR scan event (check_in / check_out / present) by a volunteer.
/**
 * AT28 — Shivir scans are isolated from Pathshala attendance.
 * Do not join this table into attendance_percentage, streak recompute, or
 * automatic attendance Punya awards.
 */
export const shivir_attendance_scans = pgTable(
  "shivir_attendance_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Denormalised from the session so the per-event live feed and the export can
     * be served without a join (SPEC 5.11 indexes on shivir + scanned_at).
     */
    shivir_id: uuid("shivir_id")
      .notNull()
      .references(() => shivir_events.id, { onDelete: "cascade" }),
    shivir_session_id: uuid("shivir_session_id")
      .notNull()
      .references(() => shivir_sessions.id, { onDelete: "cascade" }),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    volunteer_user_id: uuid("volunteer_user_id").references(() => users.id, { onDelete: "set null" }),
    scan_kind: shivirScanKindEnum("scan_kind").notNull().default("present"),
    scanned_at: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * AT19 per-item ULID — char(26), never the uuid type.
     *
     * This is now the replay anchor. The old UNIQUE (session, student, kind) had
     * to go: it capped a student at one check_in per session for all time, which
     * makes SPEC 8.6 re-entry ("last is check_out -> insert new check_in")
     * impossible to represent. Idempotency moved here, where it belongs; the
     * service adds a short re-scan window to absorb double-taps.
     */
    client_op_id: char("client_op_id", { length: 26 }),
    /** True when the scan arrived through /v1/sync/batch rather than online. */
    device_offline: boolean("device_offline").notNull().default(false),
    /**
     * Resolved against shivir_registrations AT SCAN TIME. A walk-in is recorded,
     * never refused — turning a child away at the gate over a data-entry gap is
     * the larger harm (the same reasoning as AT8). The dashboard reports the split.
     */
    was_registered: boolean("was_registered").notNull().default(false),
    ...timestamps(),
  },
  (t) => ({
    session_idx: index("idx_shivir_attendance_scans_session").on(t.shivir_session_id),
    student_idx: index("idx_shivir_attendance_scans_student").on(t.student_id),
    shivir_scanned_idx: index("idx_shivir_attendance_scans_shivir_scanned").on(
      t.shivir_id,
      t.scanned_at,
    ),
    /** Hot path for the in_out toggle: this student's last scan in this session. */
    session_student_recent_idx: index("idx_shivir_attendance_scans_session_student_recent").on(
      t.shivir_session_id,
      t.student_id,
      t.scanned_at,
    ),
    /**
     * Deliberately NOT partial. Postgres treats NULLs as distinct in a unique
     * index, so `WHERE client_op_id IS NOT NULL` would buy nothing — and a
     * partial index cannot be inferred by a bare `ON CONFLICT (client_op_id)`,
     * which is exactly how the scan service claims idempotency. Adding the
     * predicate back turns every offline scan into
     * "there is no unique or exclusion constraint matching the ON CONFLICT
     * specification" at runtime.
     */
    client_op_unique: uniqueIndex("shivir_attendance_scans_client_op_id_uq").on(t.client_op_id),
    client_op_ulid_check: check(
      "shivir_attendance_scans_client_op_id_ulid_check",
      sql`${t.client_op_id} is null or ${t.client_op_id} ~ ${sql.raw(`'${ULID_RE}'`)}`,
    ),
  }),
);

export type ShivirEvent = typeof shivir_events.$inferSelect;
export type NewShivirEvent = typeof shivir_events.$inferInsert;
export type ShivirSession = typeof shivir_sessions.$inferSelect;
export type ShivirRegistration = typeof shivir_registrations.$inferSelect;
export type ShivirVolunteer = typeof shivir_volunteers.$inferSelect;
export type ShivirAttendanceScan = typeof shivir_attendance_scans.$inferSelect;
