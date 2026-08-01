import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { timestamps } from "./_helpers";
import {
  niyamApprovalModeEnum,
  niyamMediaKindEnum,
  niyamMsvAudienceEnum,
  niyamScopeEnum,
  niyamSubmissionStatusEnum,
  niyamTypeEnum,
  proofTypeEnum,
} from "./enums";
import { cities, states } from "./geography";
import { students } from "./students";
import { users } from "./identity";
import { punya_transactions } from "./punya";

export const niyams = pgTable(
  "niyams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title_en: text("title_en").notNull(),
    title_hi: text("title_hi").notNull(),
    description_en: text("description_en"),
    description_hi: text("description_hi"),
    niyam_type: niyamTypeEnum("niyam_type").notNull().default("daily"),
    proof_type: proofTypeEnum("proof_type").notNull().default("either"),
    /** Whether at least one media item is required on submit. */
    proof_required: boolean("proof_required").notNull().default(false),
    /** auto = points now; review = pending queue. Independent of proof presence. */
    approval_mode: niyamApprovalModeEnum("approval_mode").notNull().default("auto"),
    /** Max media attachments; 0 = no media accepted. */
    max_uploads: integer("max_uploads").notNull().default(3),
    points: integer("points").notNull().default(10),
    is_active: boolean("is_active").notNull().default(true),
    start_date: date("start_date").notNull().default(sql`current_date`),
    end_date: date("end_date"),
    // Geographic reach — national has no FK; state/city require the matching id.
    scope: niyamScopeEnum("scope").notNull().default("national"),
    state_id: uuid("state_id").references(() => states.id, { onDelete: "restrict" }),
    city_id: uuid("city_id").references(() => cities.id, { onDelete: "restrict" }),
    // MSV membership filter for who may submit this niyam.
    msv_audience: niyamMsvAudienceEnum("msv_audience").notNull().default("all"),
    ...timestamps(),
  },
  (t) => ({
    scope_idx: index("idx_niyams_scope").on(t.scope),
    state_idx: index("idx_niyams_state").on(t.state_id),
    city_idx: index("idx_niyams_city").on(t.city_id),
    active_start_idx: index("idx_niyams_active_start").on(t.is_active, t.start_date),
  }),
);

export const niyam_submissions = pgTable(
  "niyam_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    niyam_id: uuid("niyam_id")
      .notNull()
      .references(() => niyams.id, { onDelete: "cascade" }),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    submission_date: date("submission_date").notNull(),
    /** Period bucket derived from submission_date + niyam_type (daily/weekly/monthly). */
    period_key: text("period_key").notNull(),
    status: niyamSubmissionStatusEnum("status").notNull().default("auto_approved"),
    points_awarded: integer("points_awarded").notNull().default(0),
    is_featured: boolean("is_featured").notNull().default(false),
    // Denormalized first media URL for legacy readers; source of truth is media table.
    proof_url: text("proof_url"),
    notes: text("notes"),
    submitted_by: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    reviewed_by: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
    rejected_at: timestamp("rejected_at", { withTimezone: true }),
    rejected_by: uuid("rejected_by").references(() => users.id, { onDelete: "set null" }),
    rejection_reason: text("rejection_reason"),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    punya_transaction_id: uuid("punya_transaction_id").references(() => punya_transactions.id, {
      onDelete: "set null",
    }),
    reversal_transaction_id: uuid("reversal_transaction_id").references(() => punya_transactions.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => ({
    // One non-rejected submission per (niyam, student, period).
    oncePerPeriod: uniqueIndex("niyam_submissions_niyam_student_period_uq")
      .on(t.niyam_id, t.student_id, t.period_key)
      .where(sql`status <> 'rejected'`),
    student_idx: index("idx_niyam_submissions_student").on(t.student_id),
    niyam_idx: index("idx_niyam_submissions_niyam").on(t.niyam_id),
    status_date_idx: index("idx_niyam_submissions_status_date").on(t.status, t.submission_date),
  }),
);

export const niyam_submission_media = pgTable(
  "niyam_submission_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submission_id: uuid("submission_id")
      .notNull()
      .references(() => niyam_submissions.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    kind: niyamMediaKindEnum("kind").notNull(),
    mime: text("mime"),
    size_bytes: integer("size_bytes"),
    ordinal: integer("ordinal").notNull().default(0),
    ...timestamps(),
  },
  (t) => ({
    submission_idx: index("idx_niyam_submission_media_submission").on(t.submission_id),
  }),
);

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
    last_period_key: text("last_period_key"),
    ...timestamps(),
  },
  (t) => ({
    student_idx: index("idx_niyam_streaks_student").on(t.student_id),
    niyam_idx: index("idx_niyam_streaks_niyam").on(t.niyam_id),
  }),
);

export const niyam_badges = pgTable(
  "niyam_badges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    niyam_id: uuid("niyam_id")
      .notNull()
      .references(() => niyams.id, { onDelete: "cascade" }),
    badge_key: text("badge_key").notNull(),
    streak_length: integer("streak_length").notNull(),
    points_awarded: integer("points_awarded").notNull().default(0),
    awarded_at: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => ({
    student_niyam_key_uq: uniqueIndex("niyam_badges_student_niyam_key_uq").on(
      t.student_id,
      t.niyam_id,
      t.badge_key,
    ),
  }),
);

export type Niyam = typeof niyams.$inferSelect;
export type NewNiyam = typeof niyams.$inferInsert;
export type NiyamSubmission = typeof niyam_submissions.$inferSelect;
export type NewNiyamSubmission = typeof niyam_submissions.$inferInsert;
export type NiyamSubmissionMedia = typeof niyam_submission_media.$inferSelect;
export type NiyamBadge = typeof niyam_badges.$inferSelect;
export type NewNiyamBadge = typeof niyam_badges.$inferInsert;
