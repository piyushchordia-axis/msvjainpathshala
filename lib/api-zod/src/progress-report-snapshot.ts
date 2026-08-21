import { z } from "zod";

/**
 * CU30 / H28 — `progress_reports.snapshot` is JSONB written with no Zod
 * validation and no version marker, even though CLAUDE.md's JSONB rule
 * requires both. `progress.ts`'s report-generation route wrote
 * `{ items, homework, quizzes, generated_at }` and SPEC §8.14's "curriculum %"
 * on the monthly report had been consumed since day one without ever being
 * defined — this is that definition.
 *
 * `snapshot_version` (a sibling integer column, `0103_progress_report_
 * snapshot_version.sql`) is what a reader branches on — NOT a key inside the
 * JSON itself:
 *   1 — pre-CU30 shape. No `courses` key. Covers every row written before
 *       this change, including rows written before quizzes existed on the
 *       snapshot at all (M9) — treat every field here as best-effort.
 *   2 — adds `courses`, one block per course the student has ANY progress on,
 *       read from `fn_course_progress` (CU28) at generation time and never
 *       recomputed by a reader.
 *
 * `parseProgressReportSnapshot` never throws — a report a family is looking
 * at must render something even if the stored JSON is unexpected, the same
 * posture Q4's "date of birth is not on record" takes over guessing.
 */

export const PROGRESS_REPORT_SNAPSHOT_VERSION_LEGACY = 1;
export const PROGRESS_REPORT_SNAPSHOT_VERSION_CURRENT = 2;

export const progressReportItemSchema = z.object({
  item_id: z.string(),
  title_en: z.string(),
  section_title: z.string().nullable().optional(),
  level: z.enum(["not_started", "in_progress", "completed", "mastered"]),
  note: z.string().nullable().optional(),
});

export const progressReportHomeworkSnapshotSchema = z.object({
  completion_rate: z.number().nullable(),
  no_homework_set: z.boolean(),
  starred_count: z.number(),
  by_status: z.record(z.string(), z.number()),
  label_en: z.string(),
  label_hi: z.string(),
  summary_en: z.string(),
  summary_hi: z.string(),
});

export const progressReportQuizSnapshotSchema = z.object({
  attempted_count: z.number(),
  average_score: z.number().nullable(),
  perfect_count: z.number(),
  punya_earned: z.number(),
  label_en: z.string(),
  label_hi: z.string(),
  summary_en: z.string(),
  summary_hi: z.string(),
});

/** One certified node (section or subsection) inside a CU30 course block. */
export const progressReportCertifiedNodeSchema = z.object({
  node_id: z.string(),
  node_kind: z.enum(["section", "subsection"]),
  title_en: z.string(),
  title_hi: z.string(),
  certified_at: z.string(),
});

/**
 * `{ course_id, coverage, mastery, section_certified, section_total,
 * certified_nodes[] }` — coverage/mastery/section_certified/section_total
 * come straight from `fn_course_progress` (CU28); `certified_nodes` is a
 * factual listing of that student's certified rows for the course, not a
 * recomputation.
 */
export const progressReportCourseBlockSchema = z.object({
  course_id: z.string(),
  coverage: z.number().min(0).max(1).nullable(),
  mastery: z.number().min(0).max(1).nullable(),
  section_certified: z.number().int().min(0),
  section_total: z.number().int().min(0),
  certified_nodes: z.array(progressReportCertifiedNodeSchema),
});

/** Version 1 — the pre-CU30 shape. Permissive: fields vary across history (M9 added quizzes). */
export const progressReportSnapshotV1Schema = z
  .object({
    items: z.array(progressReportItemSchema).optional(),
    homework: progressReportHomeworkSnapshotSchema.optional(),
    quizzes: progressReportQuizSnapshotSchema.optional(),
    generated_at: z.string().optional(),
  })
  .passthrough();

/** Version 2 — CU30's versioned shape. `courses` is required (may be an empty array). */
export const progressReportSnapshotV2Schema = z.object({
  items: z.array(progressReportItemSchema),
  homework: progressReportHomeworkSnapshotSchema,
  quizzes: progressReportQuizSnapshotSchema,
  generated_at: z.string(),
  courses: z.array(progressReportCourseBlockSchema),
});

export type ProgressReportCourseBlock = z.infer<typeof progressReportCourseBlockSchema>;
export type ProgressReportCertifiedNode = z.infer<typeof progressReportCertifiedNodeSchema>;
export type ProgressReportSnapshotV1 = z.infer<typeof progressReportSnapshotV1Schema>;
export type ProgressReportSnapshotV2 = z.infer<typeof progressReportSnapshotV2Schema>;

export type ParsedProgressReportSnapshot =
  | { version: 1; data: ProgressReportSnapshotV1 }
  | { version: 2; data: ProgressReportSnapshotV2 };

/**
 * Safe read path for any `progress_reports` row. Branches on the
 * `snapshot_version` column (never on JSON key sniffing) and never throws —
 * an unparseable or unexpectedly-shaped snapshot still returns a usable
 * (version 1, empty-ish) result rather than crashing the caller.
 */
export function parseProgressReportSnapshot(
  snapshotVersion: number,
  rawSnapshot: unknown,
): ParsedProgressReportSnapshot {
  if (snapshotVersion >= PROGRESS_REPORT_SNAPSHOT_VERSION_CURRENT) {
    const parsed = progressReportSnapshotV2Schema.safeParse(rawSnapshot);
    if (parsed.success) return { version: 2, data: parsed.data };
    // Fall through to the permissive v1 read rather than crash — a malformed
    // v2 row should still render whatever of it is recognisable.
  }
  const legacy = progressReportSnapshotV1Schema.safeParse(rawSnapshot);
  if (legacy.success) return { version: 1, data: legacy.data };
  // Completely unrecognisable payload (e.g. null) — never throw.
  return { version: 1, data: {} };
}
