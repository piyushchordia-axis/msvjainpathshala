-- Repair: columns that exist in schema.ts but were never added by a generated
-- migration (dev databases gained them out-of-band via drizzle-kit push), so
-- a fresh database diverges from the code. Every statement is guarded — on
-- environments that already match schema.ts these are all no-ops.

-- batches: multi age-group array replaced the singular NOT NULL age_group.
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "age_groups" "age_group_enum"[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'batches' AND column_name = 'age_group'
  ) THEN
    UPDATE "batches" SET "age_groups" = ARRAY["age_group"] WHERE "age_groups" = '{}';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "batches" DROP COLUMN IF EXISTS "age_group";--> statement-breakpoint
-- Shikshak assignment lives in shikshak_batch_assignments, not on the batch row.
ALTER TABLE "batches" DROP COLUMN IF EXISTS "shikshak_id";--> statement-breakpoint

-- proof_type_enum gained audio/any in code; the DB type was never extended.
-- (PG12+ allows ADD VALUE in a transaction as long as the value is not used
-- in the same transaction — it is not.)
ALTER TYPE "proof_type_enum" ADD VALUE IF NOT EXISTS 'audio';--> statement-breakpoint
ALTER TYPE "proof_type_enum" ADD VALUE IF NOT EXISTS 'any';--> statement-breakpoint

-- niyams: proof/approval/window/scope/MSV columns from the niyam fix-pass.
DO $$ BEGIN
  CREATE TYPE "niyam_approval_mode_enum" AS ENUM ('auto', 'review');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "niyam_scope_enum" AS ENUM ('national', 'state', 'city');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "niyam_msv_audience_enum" AS ENUM ('all', 'msv', 'non_msv');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "niyams" ADD COLUMN IF NOT EXISTS "proof_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "niyams" ADD COLUMN IF NOT EXISTS "approval_mode" "niyam_approval_mode_enum" DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "niyams" ADD COLUMN IF NOT EXISTS "max_uploads" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "niyams" ADD COLUMN IF NOT EXISTS "start_date" date DEFAULT current_date NOT NULL;--> statement-breakpoint
ALTER TABLE "niyams" ADD COLUMN IF NOT EXISTS "end_date" date;--> statement-breakpoint
ALTER TABLE "niyams" ADD COLUMN IF NOT EXISTS "scope" "niyam_scope_enum" DEFAULT 'national' NOT NULL;--> statement-breakpoint
ALTER TABLE "niyams" ADD COLUMN IF NOT EXISTS "state_id" uuid;--> statement-breakpoint
ALTER TABLE "niyams" ADD COLUMN IF NOT EXISTS "city_id" uuid;--> statement-breakpoint
ALTER TABLE "niyams" ADD COLUMN IF NOT EXISTS "msv_audience" "niyam_msv_audience_enum" DEFAULT 'all' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "niyams" ADD CONSTRAINT "niyams_state_id_states_id_fk"
    FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "niyams" ADD CONSTRAINT "niyams_city_id_cities_id_fk"
    FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_niyams_scope" ON "niyams" ("scope");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_niyams_state" ON "niyams" ("state_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_niyams_city" ON "niyams" ("city_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_niyams_active_start" ON "niyams" ("is_active", "start_date");--> statement-breakpoint

-- niyam_submissions: period bucketing, rejection audit trail (Q5), Punya links.
ALTER TABLE "niyam_submissions" ADD COLUMN IF NOT EXISTS "period_key" text;--> statement-breakpoint
UPDATE "niyam_submissions" SET "period_key" = to_char("submission_date", 'YYYY-MM-DD') WHERE "period_key" IS NULL;--> statement-breakpoint
ALTER TABLE "niyam_submissions" ALTER COLUMN "period_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "niyam_submissions" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "niyam_submissions" ADD COLUMN IF NOT EXISTS "rejected_by" uuid;--> statement-breakpoint
ALTER TABLE "niyam_submissions" ADD COLUMN IF NOT EXISTS "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "niyam_submissions" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "niyam_submissions" ADD COLUMN IF NOT EXISTS "punya_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "niyam_submissions" ADD COLUMN IF NOT EXISTS "reversal_transaction_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "niyam_submissions" ADD CONSTRAINT "niyam_submissions_rejected_by_users_id_fk"
    FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "niyam_submissions" ADD CONSTRAINT "niyam_submissions_punya_transaction_id_punya_transactions_id_fk"
    FOREIGN KEY ("punya_transaction_id") REFERENCES "public"."punya_transactions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "niyam_submissions" ADD CONSTRAINT "niyam_submissions_reversal_transaction_id_punya_transactions_id_fk"
    FOREIGN KEY ("reversal_transaction_id") REFERENCES "public"."punya_transactions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "niyam_submissions_niyam_student_period_uq"
  ON "niyam_submissions" ("niyam_id", "student_id", "period_key") WHERE status <> 'rejected';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_niyam_submissions_student" ON "niyam_submissions" ("student_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_niyam_submissions_niyam" ON "niyam_submissions" ("niyam_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_niyam_submissions_status_date" ON "niyam_submissions" ("status", "submission_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_niyam_submissions_student_niyam_date" ON "niyam_submissions" ("student_id", "niyam_id", "submission_date");--> statement-breakpoint

-- niyam_streaks: period bookmark for the streak-lapse cron.
ALTER TABLE "niyam_streaks" ADD COLUMN IF NOT EXISTS "last_period_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "niyam_streaks_student_niyam_uq" ON "niyam_streaks" ("student_id", "niyam_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_niyam_streaks_student" ON "niyam_streaks" ("student_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_niyam_streaks_niyam" ON "niyam_streaks" ("niyam_id");--> statement-breakpoint

-- push_quizzes: scope-based targeting; batch_id is now the optional legacy FK.
ALTER TABLE "push_quizzes" ADD COLUMN IF NOT EXISTS "scope" "quiz_scope_enum" DEFAULT 'batch' NOT NULL;--> statement-breakpoint
ALTER TABLE "push_quizzes" ALTER COLUMN "batch_id" DROP NOT NULL;--> statement-breakpoint

-- otp_codes: session-flow columns (code_hash becomes nullable alongside session_id).
ALTER TABLE "otp_codes" ADD COLUMN IF NOT EXISTS "session_id" text;--> statement-breakpoint
ALTER TABLE "otp_codes" ALTER COLUMN "code_hash" DROP NOT NULL;
