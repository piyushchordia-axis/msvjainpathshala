/**
 * Curriculum templates / instances / sections / items / assignments / progress
 * (SPEC §5.13).
 *
 * MSV curricula are super-admin-only at the service layer (CLAUDE.md Q2).
 */

import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { auditedBy, timestamps } from './_helpers';
import { batches, centres } from './centres';
import { ageGroupEnum, curriculumLevelEnum } from './enums';
import { cities } from './geography';
import { users } from './identity';
import { students } from './students';

export const curriculum_templates = pgTable('curriculum_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // 'standard' | 'msv'
  age_group: ageGroupEnum('age_group'),
  created_by_user_id: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  ...timestamps(),
});

export const curricula = pgTable('curricula', {
  id: uuid('id').primaryKey().defaultRandom(),
  city_id: uuid('city_id').references(() => cities.id, { onDelete: 'restrict' }),
  kind: text('kind').notNull(),
  template_id: uuid('template_id').references(() => curriculum_templates.id, {
    onDelete: 'set null',
  }),
  name: text('name').notNull(),
  academic_year: text('academic_year'),
  status: text('status'),
  ...timestamps(),
  ...auditedBy(() => users.id),
});

export const curriculum_sections = pgTable('curriculum_sections', {
  id: uuid('id').primaryKey().defaultRandom(),
  curriculum_id: uuid('curriculum_id')
    .notNull()
    .references(() => curricula.id, { onDelete: 'cascade' }),
  title_en: text('title_en').notNull(),
  title_hi: text('title_hi').notNull(),
  order_index: integer('order_index').notNull(),
  ...timestamps(),
});

export const curriculum_items = pgTable('curriculum_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  section_id: uuid('section_id')
    .notNull()
    .references(() => curriculum_sections.id, { onDelete: 'cascade' }),
  title_en: text('title_en').notNull(),
  title_hi: text('title_hi').notNull(),
  description_en: text('description_en'),
  description_hi: text('description_hi'),
  order_index: integer('order_index').notNull(),
  ...timestamps(),
});

export const curriculum_assignments = pgTable('curriculum_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  curriculum_id: uuid('curriculum_id')
    .notNull()
    .references(() => curricula.id, { onDelete: 'cascade' }),
  centre_id: uuid('centre_id').references(() => centres.id, { onDelete: 'cascade' }),
  batch_id: uuid('batch_id').references(() => batches.id, { onDelete: 'cascade' }),
  assigned_at: timestamp('assigned_at', { withTimezone: true }).notNull(),
  ...timestamps(),
});

export const student_curriculum_progress = pgTable(
  'student_curriculum_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    student_id: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    curriculum_item_id: uuid('curriculum_item_id')
      .notNull()
      .references(() => curriculum_items.id, { onDelete: 'cascade' }),
    level: curriculumLevelEnum('level').notNull().default('not_started'),
    updated_by_user_id: uuid('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    ...timestamps(),
  },
  (t) => ({
    uniqueStudentItem: uniqueIndex('student_curriculum_progress_unique').on(
      t.student_id,
      t.curriculum_item_id,
    ),
  }),
);

export type CurriculumTemplate = typeof curriculum_templates.$inferSelect;
export type NewCurriculumTemplate = typeof curriculum_templates.$inferInsert;
export type Curriculum = typeof curricula.$inferSelect;
export type NewCurriculum = typeof curricula.$inferInsert;
export type CurriculumSection = typeof curriculum_sections.$inferSelect;
export type NewCurriculumSection = typeof curriculum_sections.$inferInsert;
export type CurriculumItem = typeof curriculum_items.$inferSelect;
export type NewCurriculumItem = typeof curriculum_items.$inferInsert;
export type CurriculumAssignment = typeof curriculum_assignments.$inferSelect;
export type NewCurriculumAssignment = typeof curriculum_assignments.$inferInsert;
export type StudentCurriculumProgress = typeof student_curriculum_progress.$inferSelect;
export type NewStudentCurriculumProgress = typeof student_curriculum_progress.$inferInsert;
