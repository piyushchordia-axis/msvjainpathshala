import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { softDelete, timestamps } from "./_helpers";
import { homeworkStatusEnum } from "./enums";
import { batches } from "./centres";
import { students } from "./students";
import { users } from "./identity";
import { punya_transactions } from "./punya";
import { course_subsections } from "./curriculum";

export const homework_assignments = pgTable(
  "homework_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batch_id: uuid("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    /**
     * Bilingual per the CLAUDE.md rule that all user-facing content carries
     * `_en`/`_hi`. `title`/`description` are the original single-language columns
     * and remain the EN source of truth — existing rows have no Hindi, so clients
     * fall back to them rather than rendering blank. New authoring writes both.
     */
    title: text("title").notNull(),
    title_hi: text("title_hi"),
    description: text("description"),
    description_hi: text("description_hi"),
    due_date: date("due_date").notNull(),
    attachment_url: text("attachment_url"),
    is_msv: boolean("is_msv").notNull().default(false),
    /**
     * Advisory topic tag (F12) — does not write student_course_progress.
     * Cleared if the course subsection is deleted (CU29 keeps SET NULL).
     */
    subsection_id: uuid("subsection_id").references(() => course_subsections.id, {
      onDelete: "set null",
    }),
    created_by: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    batch_idx: index("idx_homework_assignments_batch").on(t.batch_id),
    subsection_idx: index("idx_homework_assignments_subsection").on(t.subsection_id),
  }),
);

export const homework_submissions = pgTable(
  "homework_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assignment_id: uuid("assignment_id")
      .notNull()
      .references(() => homework_assignments.id, { onDelete: "cascade" }),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    status: homeworkStatusEnum("status").notNull().default("pending"),
    submission_url: text("submission_url"),
    feedback_note: text("feedback_note"),
    marked_by: uuid("marked_by").references(() => users.id, { onDelete: "set null" }),
    marked_at: timestamp("marked_at", { withTimezone: true }),
    late: boolean("late").notNull().default(false),
    /** Bumped on every award-worthiness / point-value transition (AT18). */
    revision: integer("revision").notNull().default(0),
    /**
     * Current award ledger row for this grade (F3). Cleared on un-grade / return;
     * not pointed at the reversal debit.
     */
    punya_transaction_id: uuid("punya_transaction_id").references(() => punya_transactions.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => ({
    assignment_student_unique: uniqueIndex("homework_submissions_assignment_student_unique").on(
      t.assignment_id,
      t.student_id,
    ),
    /** SPEC §5.9 — (student_id, status); replaces student-only idx (F7). */
    student_status_idx: index("idx_homework_submissions_student_status").on(
      t.student_id,
      t.status,
    ),
  }),
);

export type HomeworkAssignment = typeof homework_assignments.$inferSelect;
export type NewHomeworkAssignment = typeof homework_assignments.$inferInsert;
export type HomeworkSubmission = typeof homework_submissions.$inferSelect;
export type NewHomeworkSubmission = typeof homework_submissions.$inferInsert;
