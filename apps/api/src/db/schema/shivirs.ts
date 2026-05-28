/** Shivir events + sessions + registrations + volunteers + attendance scans (SPEC §5.11). */

import {
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditedBy, softDelete, timestamps } from './_helpers';
import { shivirAttendanceModeEnum, shivirScanKindEnum } from './enums';
import { cities } from './geography';
import { users } from './identity';
import { students } from './students';

export const shivir_events = pgTable('shivir_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  city_id: uuid('city_id')
    .notNull()
    .references(() => cities.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  description: text('description'),
  start_date: date('start_date').notNull(),
  end_date: date('end_date').notNull(),
  location_text: text('location_text'),
  location_lat: numeric('location_lat', { precision: 10, scale: 7 }),
  location_lng: numeric('location_lng', { precision: 10, scale: 7 }),
  capacity: integer('capacity'),
  msv_only: boolean('msv_only').notNull().default(false),
  attendance_mode: shivirAttendanceModeEnum('attendance_mode').notNull(),
  sessions_count: integer('sessions_count').notNull().default(1),
  ...softDelete(),
  ...timestamps(),
  ...auditedBy(() => users.id),
});

export const shivir_sessions = pgTable(
  'shivir_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shivir_event_id: uuid('shivir_event_id')
      .notNull()
      .references(() => shivir_events.id, { onDelete: 'cascade' }),
    day_number: integer('day_number').notNull(),
    session_date: date('session_date').notNull(),
    start_time: time('start_time').notNull(),
    end_time: time('end_time').notNull(),
    ...timestamps(),
  },
  (t) => ({
    uniqueEventDay: uniqueIndex('shivir_sessions_event_day_unique').on(
      t.shivir_event_id,
      t.day_number,
    ),
  }),
);

export const shivir_registrations = pgTable(
  'shivir_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shivir_event_id: uuid('shivir_event_id')
      .notNull()
      .references(() => shivir_events.id, { onDelete: 'cascade' }),
    student_id: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    registered_at: timestamp('registered_at', { withTimezone: true }).notNull(),
    registered_by_user_id: uuid('registered_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: text('status').notNull(), // 'registered' | 'cancelled'
    ...timestamps(),
  },
  (t) => ({
    uniqueEventStudent: uniqueIndex('shivir_registrations_event_student_unique').on(
      t.shivir_event_id,
      t.student_id,
    ),
  }),
);

export const shivir_volunteers = pgTable('shivir_volunteers', {
  id: uuid('id').primaryKey().defaultRandom(),
  shivir_event_id: uuid('shivir_event_id')
    .notNull()
    .references(() => shivir_events.id, { onDelete: 'cascade' }),
  user_id: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  assigned_by: uuid('assigned_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  assigned_at: timestamp('assigned_at', { withTimezone: true }).notNull(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  ...timestamps(),
});

export const shivir_attendance_scans = pgTable(
  'shivir_attendance_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shivir_event_id: uuid('shivir_event_id')
      .notNull()
      .references(() => shivir_events.id, { onDelete: 'cascade' }),
    shivir_session_id: uuid('shivir_session_id')
      .notNull()
      .references(() => shivir_sessions.id, { onDelete: 'cascade' }),
    student_id: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    volunteer_user_id: uuid('volunteer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    scan_kind: shivirScanKindEnum('scan_kind').notNull(),
    scanned_at: timestamp('scanned_at', { withTimezone: true }).notNull(),
    client_op_id: uuid('client_op_id'),
    device_offline: boolean('device_offline').notNull().default(false),
    ...timestamps(),
  },
  (t) => ({
    uniqueClientOp: uniqueIndex('shivir_attendance_scans_client_op_unique').on(t.client_op_id),
  }),
);

export type ShivirEvent = typeof shivir_events.$inferSelect;
export type NewShivirEvent = typeof shivir_events.$inferInsert;
export type ShivirSession = typeof shivir_sessions.$inferSelect;
export type NewShivirSession = typeof shivir_sessions.$inferInsert;
export type ShivirRegistration = typeof shivir_registrations.$inferSelect;
export type NewShivirRegistration = typeof shivir_registrations.$inferInsert;
export type ShivirVolunteer = typeof shivir_volunteers.$inferSelect;
export type NewShivirVolunteer = typeof shivir_volunteers.$inferInsert;
export type ShivirAttendanceScan = typeof shivir_attendance_scans.$inferSelect;
export type NewShivirAttendanceScan = typeof shivir_attendance_scans.$inferInsert;
