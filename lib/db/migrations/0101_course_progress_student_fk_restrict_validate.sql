-- L15, part 2 of 2 — VALIDATE the two NOT VALID constraints added in 0100, in
-- their own transaction (see 0100's header).

ALTER TABLE "progress_reports" VALIDATE CONSTRAINT "progress_reports_student_id_students_id_fk";--> statement-breakpoint
ALTER TABLE "punya_transactions" VALIDATE CONSTRAINT "punya_transactions_student_id_students_id_fk";--> statement-breakpoint
