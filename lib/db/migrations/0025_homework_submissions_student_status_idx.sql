-- F7: SPEC §5.9 composite (student_id, status).
-- Replaces the student-only index: the composite covers student_id-prefix lookups.

DROP INDEX IF EXISTS "idx_homework_submissions_student";
CREATE INDEX IF NOT EXISTS "idx_homework_submissions_student_status"
  ON "homework_submissions" ("student_id", "status");
