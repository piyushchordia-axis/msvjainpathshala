-- Join registration: real date of birth, staff gender, student-only payment.
--
-- `age` was collected as a whole number and the server fabricated a 1-January
-- DOB from it, which is what the Q4 login gate (MIN_STUDENT_LOGIN_AGE) was
-- evaluated against. Collect the real date instead. The `age` columns stay so
-- historical rows keep their value; from now on age is derived from DOB on write.

ALTER TABLE "join_student_registrations"   ADD COLUMN IF NOT EXISTS "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "join_shikshak_registrations"  ADD COLUMN IF NOT EXISTS "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "join_sanchalak_registrations" ADD COLUMN IF NOT EXISTS "date_of_birth" date;--> statement-breakpoint

-- Explicit gender for staff: a shikshak's is derived from the गुरुजी / दीदी
-- choice, but a sanchalak's role is hardcoded 'संचालक' and carries no signal.
ALTER TABLE "join_shikshak_registrations"  ADD COLUMN IF NOT EXISTS "sex" text;--> statement-breakpoint
ALTER TABLE "join_sanchalak_registrations" ADD COLUMN IF NOT EXISTS "sex" text;--> statement-breakpoint

-- Flip the configured form field in place, keeping display_order and is_required.
UPDATE "join_form_fields"
   SET "field_key" = 'date_of_birth',
       "field_type" = 'date',
       "label_hi" = 'जन्म तिथि',
       "label_en" = 'Date of birth',
       "placeholder_hi" = NULL,
       "placeholder_en" = NULL
 WHERE "field_key" = 'age';--> statement-breakpoint

-- Sanchalak gender, slotted immediately after date_of_birth.
UPDATE "join_form_fields"
   SET "display_order" = "display_order" + 1
 WHERE "kind" = 'sanchalak' AND "display_order" >= 4;--> statement-breakpoint

INSERT INTO "join_form_fields"
  ("kind", "field_key", "label_hi", "label_en", "field_type", "options", "is_required", "display_order")
VALUES
  ('sanchalak', 'sex', 'लिंग', 'Gender', 'dropdown', '["Male","Female"]'::jsonb, true, 4)
ON CONFLICT ("kind", "field_key") DO NOTHING;--> statement-breakpoint

-- Payment is only collected for the student MSV journey.
DELETE FROM "join_settings"
 WHERE "kind" IN ('shikshak', 'sanchalak')
   AND "key" LIKE 'payment\_%';
