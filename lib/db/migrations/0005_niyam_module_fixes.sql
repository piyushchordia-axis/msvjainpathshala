-- N1: Niyam module data-model fixes (idempotency, rejection cols, badges, indexes).
-- Backfill order: add columns → rewrite feature_key composites → then unique index.

--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."niyam_badge_key_enum" AS ENUM (
    'daily_7', 'daily_14', 'daily_30', 'daily_60', 'daily_100', 'weekly_4', 'monthly_3'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint

ALTER TABLE "punya_transactions" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "punya_transactions" ADD COLUMN IF NOT EXISTS "reversal_of" uuid;
--> statement-breakpoint
ALTER TABLE "punya_transactions" ADD COLUMN IF NOT EXISTS "source_entity_kind" text;
--> statement-breakpoint
ALTER TABLE "punya_transactions" ADD COLUMN IF NOT EXISTS "source_entity_id" uuid;

--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "punya_transactions"
    ADD CONSTRAINT "punya_transactions_reversal_of_punya_transactions_id_fk"
    FOREIGN KEY ("reversal_of") REFERENCES "public"."punya_transactions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint

ALTER TABLE "niyam_submissions" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "niyam_submissions" ADD COLUMN IF NOT EXISTS "rejected_by" uuid;
--> statement-breakpoint
ALTER TABLE "niyam_submissions" ADD COLUMN IF NOT EXISTS "rejection_reason" text;
--> statement-breakpoint
ALTER TABLE "niyam_submissions" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "niyam_submissions" ADD COLUMN IF NOT EXISTS "punya_transaction_id" uuid;
--> statement-breakpoint
ALTER TABLE "niyam_submissions" ADD COLUMN IF NOT EXISTS "reversal_transaction_id" uuid;

--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "niyam_submissions"
    ADD CONSTRAINT "niyam_submissions_rejected_by_users_id_fk"
    FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "niyam_submissions"
    ADD CONSTRAINT "niyam_submissions_punya_transaction_id_punya_transactions_id_fk"
    FOREIGN KEY ("punya_transaction_id") REFERENCES "public"."punya_transactions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "niyam_submissions"
    ADD CONSTRAINT "niyam_submissions_reversal_tx_id_fk"
    FOREIGN KEY ("reversal_transaction_id") REFERENCES "public"."punya_transactions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint

ALTER TABLE "niyams" ADD COLUMN IF NOT EXISTS "start_date" date DEFAULT current_date;
--> statement-breakpoint
UPDATE "niyams" SET "start_date" = current_date WHERE "start_date" IS NULL;
--> statement-breakpoint
ALTER TABLE "niyams" ALTER COLUMN "start_date" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "niyams" ALTER COLUMN "start_date" SET DEFAULT current_date;
--> statement-breakpoint
ALTER TABLE "niyams" ADD COLUMN IF NOT EXISTS "end_date" date;

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "niyam_badges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "student_id" uuid NOT NULL,
  "niyam_id" uuid NOT NULL,
  "badge_key" text NOT NULL,
  "streak_length" integer NOT NULL,
  "points_awarded" integer DEFAULT 0 NOT NULL,
  "awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "niyam_badges"
    ADD CONSTRAINT "niyam_badges_student_id_students_id_fk"
    FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "niyam_badges"
    ADD CONSTRAINT "niyam_badges_niyam_id_niyams_id_fk"
    FOREIGN KEY ("niyam_id") REFERENCES "public"."niyams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "niyam_badges_student_niyam_key_uq"
  ON "niyam_badges" USING btree ("student_id", "niyam_id", "badge_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_punya_transactions_feature"
  ON "punya_transactions" USING btree ("feature_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_punya_transactions_reversal"
  ON "punya_transactions" USING btree ("reversal_of")
  WHERE "reversal_of" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_niyam_submissions_status_date"
  ON "niyam_submissions" USING btree ("status", "submission_date" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gallery_items_submission"
  ON "gallery_items" USING btree ("submission_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_niyams_active_start"
  ON "niyams" USING btree ("is_active", "start_date");

--> statement-breakpoint

-- Backfill: split composite feature_key = '<kind>#<idempotency_key>'
UPDATE "punya_transactions"
SET
  "idempotency_key" = split_part("feature_key", '#', 2),
  "feature_key" = split_part("feature_key", '#', 1),
  "source_entity_kind" = 'niyam_submission'
WHERE "feature_key" LIKE 'niyam_submission#%';

--> statement-breakpoint

UPDATE "punya_transactions"
SET
  "idempotency_key" = split_part("feature_key", '#', 2),
  "feature_key" = split_part("feature_key", '#', 1),
  "source_entity_kind" = split_part("feature_key", '#', 1)
WHERE "feature_key" LIKE '%#%'
  AND "feature_key" NOT LIKE 'niyam_submission#%';

--> statement-breakpoint

-- Fix source_entity_kind for the non-niyam branch (feature_key already split above).
UPDATE "punya_transactions"
SET "source_entity_kind" = "feature_key"
WHERE "source_entity_kind" IS NULL
  AND "idempotency_key" IS NOT NULL
  AND "feature_key" NOT LIKE '%#%';

--> statement-breakpoint

-- Derive source_entity_id from submission:<uuid> portion of idempotency_key
UPDATE "punya_transactions"
SET "source_entity_id" = (regexp_match("idempotency_key", '^submission:([0-9a-fA-F-]{36})'))[1]::uuid
WHERE "idempotency_key" ~ '^submission:[0-9a-fA-F-]{36}'
  AND "source_entity_id" IS NULL;

--> statement-breakpoint

-- Link reversals: '<key>:reversal' → original '<key>'
UPDATE "punya_transactions" AS rev
SET "reversal_of" = orig.id
FROM "punya_transactions" AS orig
WHERE rev."idempotency_key" LIKE '%:reversal'
  AND orig."idempotency_key" = left(rev."idempotency_key", length(rev."idempotency_key") - length(':reversal'))
  AND rev."reversal_of" IS NULL;

--> statement-breakpoint

-- Unique index LAST so duplicates fail the migration loudly
CREATE UNIQUE INDEX IF NOT EXISTS "punya_transactions_idempotency_key_uq"
  ON "punya_transactions" USING btree ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
