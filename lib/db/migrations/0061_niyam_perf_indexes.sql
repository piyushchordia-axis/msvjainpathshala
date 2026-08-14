-- Niyam catalog / streak hot-path indexes (view-niyam performance).

-- Keep one streak row per (student, niyam); drop older duplicates first.
DELETE FROM "niyam_streaks" a
USING "niyam_streaks" b
WHERE a."student_id" = b."student_id"
  AND a."niyam_id" = b."niyam_id"
  AND a."id" < b."id";

CREATE UNIQUE INDEX IF NOT EXISTS "niyam_streaks_student_niyam_uq"
  ON "niyam_streaks" ("student_id", "niyam_id");

CREATE INDEX IF NOT EXISTS "idx_niyam_submissions_student_niyam_date"
  ON "niyam_submissions" ("student_id", "niyam_id", "submission_date");
