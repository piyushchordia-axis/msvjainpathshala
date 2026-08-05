-- Exams cleanup (SPEC §5.14): attempt status enum, answer grading columns,
-- composite indexes for online_exams / exam_attempts.

CREATE TYPE "public"."exam_attempt_status_enum" AS ENUM(
  'in_progress',
  'submitted',
  'graded',
  'abandoned'
);--> statement-breakpoint

-- Cast existing text status through the new enum (values already match).
ALTER TABLE "exam_attempts"
  ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint

ALTER TABLE "exam_attempts"
  ALTER COLUMN "status" TYPE "public"."exam_attempt_status_enum"
  USING ("status"::"public"."exam_attempt_status_enum");--> statement-breakpoint

ALTER TABLE "exam_attempts"
  ALTER COLUMN "status" SET DEFAULT 'in_progress'::"public"."exam_attempt_status_enum";--> statement-breakpoint

ALTER TABLE "exam_answers" ADD COLUMN IF NOT EXISTS "admin_comment" text;--> statement-breakpoint

ALTER TABLE "exam_answers" ADD COLUMN IF NOT EXISTS "graded_by_user_id" uuid;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "exam_answers"
    ADD CONSTRAINT "exam_answers_graded_by_user_id_users_id_fk"
    FOREIGN KEY ("graded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- online_exams: (city_id, window_start) replaces standalone city index.
DROP INDEX IF EXISTS "idx_online_exams_city";--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_online_exams_city_window"
  ON "online_exams" ("city_id", "window_start");--> statement-breakpoint

-- exam_attempts: (exam_id, student_id) replaces standalone exam_id index.
DROP INDEX IF EXISTS "idx_exam_attempts_exam";--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_exam_attempts_exam_student"
  ON "exam_attempts" ("exam_id", "student_id");
