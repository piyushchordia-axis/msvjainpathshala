import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { softDelete, timestamps } from "./_helpers";
import { ageGroupEnum, languageEnum, studentStatusEnum } from "./enums";
import { cities, states } from "./geography";
import { users } from "./identity";

export const centres = pgTable(
  "centres",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    state_id: uuid("state_id")
      .notNull()
      .references(() => states.id, { onDelete: "restrict" }),
    city_id: uuid("city_id")
      .notNull()
      .references(() => cities.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    locality: text("locality"),
    pincode: varchar("pincode", { length: 10 }),
    contact_phone: varchar("contact_phone", { length: 15 }),
    contact_email: varchar("contact_email", { length: 255 }),
    // GPS geofence for attendance marking (nullable until configured).
    lat: numeric("lat", { precision: 10, scale: 7 }),
    lng: numeric("lng", { precision: 10, scale: 7 }),
    gps_radius_m: integer("gps_radius_m").notNull().default(200),
    status: studentStatusEnum("status").notNull().default("active"),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    city_idx: index("idx_centres_city").on(t.city_id),
    state_idx: index("idx_centres_state").on(t.state_id),
  }),
);

export const batches = pgTable(
  "batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    centre_id: uuid("centre_id")
      .notNull()
      .references(() => centres.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    age_groups: ageGroupEnum("age_groups").array().notNull().default([]),
    day_of_week: integer("day_of_week").array().notNull().default([]),
    start_time: time("start_time").notNull(),
    end_time: time("end_time").notNull(),
    capacity: integer("capacity").notNull().default(30),
    language_preference: languageEnum("language_preference"),
    status: studentStatusEnum("status").notNull().default("active"),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    centre_idx: index("idx_batches_centre").on(t.centre_id),
  }),
);

export const centre_holidays = pgTable(
  "centre_holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    centre_id: uuid("centre_id")
      .notNull()
      .references(() => centres.id, { onDelete: "cascade" }),
    holiday_date: date("holiday_date").notNull(),
    reason: text("reason"),
    ...timestamps(),
  },
  (t) => ({
    centre_idx: index("idx_centre_holidays_centre").on(t.centre_id),
  }),
);

export const sanchalak_centre_assignments = pgTable(
  "sanchalak_centre_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    centre_id: uuid("centre_id")
      .notNull()
      .references(() => centres.id, { onDelete: "cascade" }),
    is_active: boolean("is_active").notNull().default(true),
    assigned_by: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    deactivated_at: timestamp("deactivated_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    user_idx: index("idx_sanchalak_centre_assignments_user").on(t.user_id),
    centre_idx: index("idx_sanchalak_centre_assignments_centre").on(t.centre_id),
    active_user_centre_uq: uniqueIndex("sanchalak_centre_assignments_active_user_centre_uq")
      .on(t.user_id, t.centre_id)
      .where(sql`is_active`),
  }),
);

/** Coarse shikshak↔centre membership (required before any batch assignment). */
export const shikshak_centre_assignments = pgTable(
  "shikshak_centre_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    centre_id: uuid("centre_id")
      .notNull()
      .references(() => centres.id, { onDelete: "cascade" }),
    is_active: boolean("is_active").notNull().default(true),
    assigned_by: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    deactivated_at: timestamp("deactivated_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    user_idx: index("idx_shikshak_centre_assignments_user").on(t.user_id),
    centre_idx: index("idx_shikshak_centre_assignments_centre").on(t.centre_id),
    active_user_centre_uq: uniqueIndex("shikshak_centre_assignments_active_user_centre_uq")
      .on(t.user_id, t.centre_id)
      .where(sql`is_active`),
  }),
);

export const shikshak_batch_assignments = pgTable(
  "shikshak_batch_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    batch_id: uuid("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    is_active: boolean("is_active").notNull().default(true),
    /** Display / default assignee only — no extra permission. */
    is_primary: boolean("is_primary").notNull().default(false),
    assigned_by: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    deactivated_at: timestamp("deactivated_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    user_idx: index("idx_shikshak_batch_assignments_user").on(t.user_id),
    batch_idx: index("idx_shikshak_batch_assignments_batch").on(t.batch_id),
    active_user_batch_uq: uniqueIndex("shikshak_batch_assignments_active_user_batch_uq")
      .on(t.user_id, t.batch_id)
      .where(sql`is_active`),
    active_primary_per_batch_uq: uniqueIndex("shikshak_batch_assignments_active_primary_uq")
      .on(t.batch_id)
      .where(sql`is_active AND is_primary`),
  }),
);

export type Centre = typeof centres.$inferSelect;
export type NewCentre = typeof centres.$inferInsert;
export type Batch = typeof batches.$inferSelect;
export type NewBatch = typeof batches.$inferInsert;
export type SanchalakCentreAssignment = typeof sanchalak_centre_assignments.$inferSelect;
export type ShikshakCentreAssignment = typeof shikshak_centre_assignments.$inferSelect;
export type ShikshakBatchAssignment = typeof shikshak_batch_assignments.$inferSelect;
