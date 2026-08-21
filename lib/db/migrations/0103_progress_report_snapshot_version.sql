-- CU30 / H28 — progress_reports.snapshot gains a versioned curriculum block.
--
-- progress.ts's report-generation snapshot has carried `{ items, homework,
-- quizzes, generated_at }` with no version marker at all — SPEC §8.14's
-- "curriculum %" on the monthly report has been consumed since day one
-- without ever being defined. This adds the version column the JSONB shape
-- needs so a reader can tell an old snapshot from a new one without
-- inspecting keys. Existing rows default to 1 (their real shape: no
-- `courses` key) and every future report.ts write sets it explicitly to 2
-- (the versioned shape with the CU28 `courses` block) — the DEFAULT here
-- only backfills history, it is never relied on for a new write.

ALTER TABLE "progress_reports"
  ADD COLUMN IF NOT EXISTS "snapshot_version" integer NOT NULL DEFAULT 1;
