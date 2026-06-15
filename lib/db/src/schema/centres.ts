import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  time,
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
    age_group: ageGroupEnum("age_group").notNull(),
    shikshak_id: uuid("shikshak_id").references(() => users.id, { onDelete: "set null" }),
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
    shikshak_idx: index("idx_batches_shikshak").on(t.shikshak_id),
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
    ...timestamps(),
  },
  (t) => ({
    user_idx: index("idx_sanchalak_centre_assignments_user").on(t.user_id),
    centre_idx: index("idx_sanchalak_centre_assignments_centre").on(t.centre_id),
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
    ...timestamps(),
  },
  (t) => ({
    user_idx: index("idx_shikshak_batch_assignments_user").on(t.user_id),
    batch_idx: index("idx_shikshak_batch_assignments_batch").on(t.batch_id),
  }),
);

export type Centre = typeof centres.$inferSelect;
export type NewCentre = typeof centres.$inferInsert;
export type Batch = typeof batches.$inferSelect;
export type NewBatch = typeof batches.$inferInsert;
