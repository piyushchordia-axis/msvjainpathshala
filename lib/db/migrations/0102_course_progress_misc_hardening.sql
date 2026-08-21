-- L12 + L14 — both verified against the live migration chain before writing
-- this file (docker jp-postgres / jp_clean, all 98 prior migrations applied).
-- Neither turned out to be a live bug; both statements below are safe no-ops
-- kept for the documentation/defensive value the review asked for.
--
-- L12 claimed `DROP INDEX IF EXISTS "student_curriculum_progress_student_item_unique"`
-- (0051:156) silently no-ops when that index backs a UNIQUE table constraint.
-- Checked: it never did. Baseline (0000) created it as a plain
-- `CREATE UNIQUE INDEX`, never as `ADD CONSTRAINT ... UNIQUE`, and no
-- migration between 0000 and 0051 touched it — pg_constraint on the current
-- jp_clean has no such constraint, and DROP INDEX (without IF EXISTS even)
-- would have hard-failed 0051 at the time it first ran had this been a
-- constraint-backed index, not silently succeeded. This DROP CONSTRAINT
-- IF EXISTS is a genuine no-op today; it stays as insurance against any
-- environment whose history diverged from this repo's.
--
-- L14 claimed student_course_progress.status's Drizzle-declared default
-- ('not_started') didn't match the real SQL default after 0051 renamed the
-- column from `level`. Checked: RENAME COLUMN preserves the column default,
-- and baseline (0000) declared `DEFAULT 'not_started' NOT NULL` on `level`
-- — jp_clean's live default is `'not_started'::curriculum_level_enum`,
-- matching lib/db/src/schema/curriculum.ts:180 exactly. The explicit
-- SET DEFAULT below is a no-op that makes the value visible in the migration
-- chain itself instead of only inferable by tracing back to 0000.

ALTER TABLE "student_course_progress" DROP CONSTRAINT IF EXISTS "student_curriculum_progress_student_item_unique";--> statement-breakpoint
ALTER TABLE "student_course_progress" ALTER COLUMN "status" SET DEFAULT 'not_started'::"curriculum_level_enum";--> statement-breakpoint
