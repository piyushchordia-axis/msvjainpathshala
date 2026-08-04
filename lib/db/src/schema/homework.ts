import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { softDelete, timestamps } from "./_helpers";
import { homeworkStatusEnum } from "./enums";
import { batches } from "./centres";
import { students } from "./students";
import { users } from "./identity";

export const homework_assignments = pgTable(
  "homework_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batch_id: uuid("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    due_date: date("due_date").notNull(),
    attachment_url: text("attachment_url"),
    is_msv: boolean("is_msv").notNull().default(false),
    // NULL = every active student in the batch; otherwise a subset.
    target_student_ids: uuid("target_student_ids").array(),
    created_by: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    batch_idx: index("idx_homework_assignments_batch").on(t.batch_id),
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
    ...timestamps(),
  },
  (t) => ({
    assignment_student_unique: uniqueIndex("homework_submissions_assignment_student_unique").on(
      t.assignment_id,
      t.student_id,
    ),
    assignment_idx: index("idx_homework_submissions_assignment").on(t.assignment_id),
    student_idx: index("idx_homework_submissions_student").on(t.student_id),
  }),
);

export type HomeworkAssignment = typeof homework_assignments.$inferSelect;
export type NewHomeworkAssignment = typeof homework_assignments.$inferInsert;
export type HomeworkSubmission = typeof homework_submissions.$inferSelect;
export type NewHomeworkSubmission = typeof homework_submissions.$inferInsert;
