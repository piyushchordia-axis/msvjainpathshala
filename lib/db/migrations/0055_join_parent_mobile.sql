-- Parent mobile for student join (OTP parent login / tagging on approve).

ALTER TABLE "join_student_registrations"
  ADD COLUMN IF NOT EXISTS "parent_mobile" text;--> statement-breakpoint

UPDATE "join_student_registrations"
SET "parent_mobile" = "mobile"
WHERE "parent_mobile" IS NULL OR "parent_mobile" = '';--> statement-breakpoint

ALTER TABLE "join_student_registrations"
  ALTER COLUMN "parent_mobile" SET NOT NULL;--> statement-breakpoint

-- Student contact mobile is optional (parent_mobile is the login key).
ALTER TABLE "join_student_registrations"
  ALTER COLUMN "mobile" DROP NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_join_student_registrations_parent_mobile"
  ON "join_student_registrations" ("parent_mobile");--> statement-breakpoint
