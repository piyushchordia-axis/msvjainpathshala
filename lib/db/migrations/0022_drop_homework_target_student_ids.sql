-- FIX #14 (b): fan-out rows are the source of truth; drop write-only target list.
ALTER TABLE "homework_assignments" DROP COLUMN IF EXISTS "target_student_ids";--> statement-breakpoint
