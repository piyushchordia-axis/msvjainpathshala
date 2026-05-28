/**
 * Students + enrolment + MSV + digital ID cards (SPEC §5.3, §5.5).
 *
 * Students are NEVER hard-deleted (CLAUDE.md Q11) — `deleted_at` plus
 * `status='inactive'` + `deactivated_at` are the soft-delete signals.
 */

import {
  boolean,
  date,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditedBy, softDelete, timestamps } from './_helpers';
import { batches, centres } from './centres';
import { ageGroupEnum, enrolmentStatusEnum, msvStatusEnum, studentStatusEnum } from './enums';
import { users } from './identity';

// Forward declaration handle for the form-response FK cycle:
// students → registration_form_responses (no — actually enrolments → responses).
// We declare enrolments.form_response_id as plain uuid here and add the FK
// in 0002_indexes.sql once form_configs.ts has emitted the target table.

export const students = pgTable(
  'students',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parent_user_id: uuid('parent_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    full_name: text('full_name').notNull(),
    father_name: text('father_name'),
    dob: date('dob').notNull(),
    age_group: ageGroupEnum('age_group').notNull(),
    // No FK — see media.ts file-level note about cyclic relationships.
    profile_photo_asset_id: uuid('profile_photo_asset_id'),
    centre_id: uuid('centre_id')
      .notNull()
      .references(() => centres.id, { onDelete: 'restrict' }),
    batch_id: uuid('batch_id').references(() => batches.id, { onDelete: 'set null' }),
    // Human-readable ID code, e.g. 'MSV-AHM-00123'.
    student_code: text('student_code').notNull(),
    msv_status: msvStatusEnum('msv_status').notNull().default('none'),
    status: studentStatusEnum('status').notNull().default('active'),
    enrolled_at: timestamp('enrolled_at', { withTimezone: true }).notNull(),
    deactivated_at: timestamp('deactivated_at', { withTimezone: true }),
    // Enables parent-view → student-view toggle for ≥13yo (CLAUDE.md Q4).
    student_view_enabled: boolean('student_view_enabled').notNull().default(false),
    ...softDelete(),
    ...timestamps(),
    ...auditedBy(() => users.id),
  },
  (t) => ({
    uniqueCode: uniqueIndex('students_student_code_unique').on(t.student_code),
  }),
);

// ---------------------------------------------------------------------------
// enrolments — initial pathshala enrolment workflow
// ---------------------------------------------------------------------------

export const enrolments = pgTable('enrolments', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Set after approval; nullable while pending (the student record is created
  // on approval, so this stays NULL during pending/waitlisted/rejected).
  student_id: uuid('student_id').references(() => students.id, { onDelete: 'set null' }),
  parent_user_id: uuid('parent_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  requested_centre_id: uuid('requested_centre_id')
    .notNull()
    .references(() => centres.id, { onDelete: 'restrict' }),
  requested_batch_id: uuid('requested_batch_id')
    .notNull()
    .references(() => batches.id, { onDelete: 'restrict' }),
  status: enrolmentStatusEnum('status').notNull(),
  reviewer_user_id: uuid('reviewer_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  decided_at: timestamp('decided_at', { withTimezone: true }),
  rejection_reason: text('rejection_reason'),
  // FK to registration_form_responses added in 0002_indexes.sql to avoid
  // forward import — form_configs.ts depends on identity + cities, not on
  // students.
  form_response_id: uuid('form_response_id'),
  ...softDelete(),
  ...timestamps(),
  ...auditedBy(() => users.id),
});

// ---------------------------------------------------------------------------
// msv_enrolments — MSV programme application (CLAUDE.md Q1: admin discretion)
// ---------------------------------------------------------------------------

export const msv_enrolments = pgTable('msv_enrolments', {
  id: uuid('id').primaryKey().defaultRandom(),
  student_id: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'restrict' }),
  application_form_response_id: uuid('application_form_response_id'),
  motivation_statement_redacted: text('motivation_statement_redacted'),
  recommending_shikshak_id: uuid('recommending_shikshak_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  status: msvStatusEnum('status').notNull(),
  reviewer_user_id: uuid('reviewer_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  decided_at: timestamp('decided_at', { withTimezone: true }),
  certificate_year: integer('certificate_year'),
  notes: text('notes'),
  ...timestamps(),
  ...auditedBy(() => users.id),
});

// ---------------------------------------------------------------------------
// digital_id_cards (SPEC §5.5)
// ---------------------------------------------------------------------------

export const digital_id_cards = pgTable(
  'digital_id_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    student_id: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    card_number: text('card_number').notNull(),
    qr_payload: text('qr_payload').notNull(),
    qr_payload_signature: text('qr_payload_signature').notNull(), // HMAC
    png_asset_id: uuid('png_asset_id'),
    svg_payload: text('svg_payload'),
    msv_badge: boolean('msv_badge').notNull().default(false),
    version_no: integer('version_no').notNull(),
    generated_at: timestamp('generated_at', { withTimezone: true }).notNull(),
    last_regenerated_at: timestamp('last_regenerated_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    uniqueStudent: uniqueIndex('digital_id_cards_student_unique').on(t.student_id),
  }),
);

export type Student = typeof students.$inferSelect;
export type NewStudent = typeof students.$inferInsert;
export type Enrolment = typeof enrolments.$inferSelect;
export type NewEnrolment = typeof enrolments.$inferInsert;
export type MsvEnrolment = typeof msv_enrolments.$inferSelect;
export type NewMsvEnrolment = typeof msv_enrolments.$inferInsert;
export type DigitalIdCard = typeof digital_id_cards.$inferSelect;
export type NewDigitalIdCard = typeof digital_id_cards.$inferInsert;
