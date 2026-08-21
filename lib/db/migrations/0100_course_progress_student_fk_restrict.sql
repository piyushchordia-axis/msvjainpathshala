-- L15 (CU §11 open item) — Q11 says students are deactivated, never deleted;
-- a CASCADE FK on student_id assumes a hard delete that must never happen.
-- 0051 swapped four course-tree CASCADE FKs to RESTRICT (CU29) but explicitly
-- deferred progress_reports.student_id and punya_transactions.student_id —
-- both still CASCADE today. Neither table is 0051/0052/0058, so this is a
-- normal new migration, not an edit to a frozen one.
--
-- Part 1 of 2 (L11 lesson applied going forward, even though it can't be
-- applied retroactively to 0051 itself): ADD CONSTRAINT ... NOT VALID here,
-- VALIDATE CONSTRAINT in the next migration file, so the two run as separate
-- transactions under migrate.mjs (one file = one BEGIN/COMMIT) instead of
-- holding whatever lock the ADD step takes through a same-transaction table
-- scan.

ALTER TABLE "progress_reports"
  DROP CONSTRAINT "progress_reports_student_id_students_id_fk";--> statement-breakpoint
ALTER TABLE "progress_reports"
  ADD CONSTRAINT "progress_reports_student_id_students_id_fk"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint

ALTER TABLE "punya_transactions"
  DROP CONSTRAINT "punya_transactions_student_id_students_id_fk";--> statement-breakpoint
ALTER TABLE "punya_transactions"
  ADD CONSTRAINT "punya_transactions_student_id_students_id_fk"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
