import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { timestamps } from "./_helpers";
import { niyamSubmissionStatusEnum, niyamTypeEnum, proofTypeEnum } from "./enums";
import { students } from "./students";
import { users } from "./identity";

export const niyams = pgTable("niyams", {
  id: uuid("id").primaryKey().defaultRandom(),
  title_en: text("title_en").notNull(),
  title_hi: text("title_hi").notNull(),
  description_en: text("description_en"),
  description_hi: text("description_hi"),
  niyam_type: niyamTypeEnum("niyam_type").notNull().default("daily"),
  proof_type: proofTypeEnum("proof_type").notNull().default("either"),
  points: integer("points").notNull().default(10),
  is_active: boolean("is_active").notNull().default(true),
  ...timestamps(),
});

export const niyam_submissions = pgTable("niyam_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  niyam_id: uuid("niyam_id")
    .notNull()
    .references(() => niyams.id, { onDelete: "cascade" }),
  student_id: uuid("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  submission_date: date("submission_date").notNull(),
  status: niyamSubmissionStatusEnum("status").notNull().default("auto_approved"),
  points_awarded: integer("points_awarded").notNull().default(0),
  is_featured: boolean("is_featured").notNull().default(false),
  // Submission provenance + proof + review trail.
  proof_url: text("proof_url"),
  notes: text("notes"),
  submitted_by: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
  reviewed_by: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
  ...timestamps(),
}, (t) => ({
  // One non-rejected submission per (niyam, student, day) — defense-in-depth for
  // the auto-approve race (the submit path also takes an advisory lock).
  oncePerDay: uniqueIndex("niyam_submissions_niyam_student_date_uq")
    .on(t.niyam_id, t.student_id, t.submission_date)
    .where(sql`status <> 'rejected'`),
  student_idx: index("idx_niyam_submissions_student").on(t.student_id),
  niyam_idx: index("idx_niyam_submissions_niyam").on(t.niyam_id),
}));

export const niyam_streaks = pgTable(
  "niyam_streaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    niyam_id: uuid("niyam_id")
      .notNull()
      .references(() => niyams.id, { onDelete: "cascade" }),
    current_streak: integer("current_streak").notNull().default(0),
    longest_streak: integer("longest_streak").notNull().default(0),
    last_submission_date: date("last_submission_date"),
    ...timestamps(),
  },
  (t) => ({
    student_idx: index("idx_niyam_streaks_student").on(t.student_id),
    niyam_idx: index("idx_niyam_streaks_niyam").on(t.niyam_id),
  }),
);

export type Niyam = typeof niyams.$inferSelect;
export type NewNiyam = typeof niyams.$inferInsert;
export type NiyamSubmission = typeof niyam_submissions.$inferSelect;
export type NewNiyamSubmission = typeof niyam_submissions.$inferInsert;
