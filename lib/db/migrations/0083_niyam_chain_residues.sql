-- Residues left behind by the 2026-08-17 drift repair (0068 / 0069).
-- All guarded; no-ops on an environment that is already correct.

-- ---------------------------------------------------------------------------
-- L9 — 0069 added niyam_streaks.last_period_key with NO backfill, and the
-- nightly lapse job filters `last_period_key is not null`. Every streak row
-- created before that migration is therefore invisible to the cron and keeps a
-- frozen non-zero current_streak forever — a child who stopped submitting
-- months ago still shows an active streak.
--
-- Derive it from the row's own last_submission_date using the niyam's
-- frequency, exactly as recomputeStreak would (daily YYYY-MM-DD, weekly ISO
-- YYYY-Www, monthly YYYY-MM).
-- ---------------------------------------------------------------------------
UPDATE "niyam_streaks" ns
SET "last_period_key" = CASE n."niyam_type"
    WHEN 'weekly'  THEN to_char(ns."last_submission_date", 'IYYY-"W"IW')
    WHEN 'monthly' THEN to_char(ns."last_submission_date", 'YYYY-MM')
    ELSE to_char(ns."last_submission_date", 'YYYY-MM-DD')
  END
FROM "niyams" n
WHERE n."id" = ns."niyam_id"
  AND ns."last_period_key" IS NULL
  AND ns."last_submission_date" IS NOT NULL;--> statement-breakpoint

-- A row with no submission date at all cannot have a live streak.
UPDATE "niyam_streaks"
SET "current_streak" = 0
WHERE "last_period_key" IS NULL
  AND "last_submission_date" IS NULL
  AND "current_streak" <> 0;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The baseline's per-DATE uniqueness is the wrong grain for weekly/monthly
-- niyams: two submissions on different dates inside the same week both passed
-- it. 0069 added the correct per-PERIOD index; this drops the superseded one,
-- which also removes live drift (schema.ts declares only oncePerPeriod, so the
-- next `drizzle-kit generate` would emit this DROP anyway).
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "niyam_submissions_niyam_student_date_uq";
