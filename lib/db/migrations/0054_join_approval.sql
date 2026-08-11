-- Join registration approval + student centre binding.

-- Student: add centre_id (nullable first, backfill, then NOT NULL)
ALTER TABLE "join_student_registrations" ADD COLUMN IF NOT EXISTS "centre_id" uuid;--> statement-breakpoint

UPDATE "join_student_registrations" jsr
SET "centre_id" = c.id
FROM (
  SELECT DISTINCT ON ("city_id") "id", "city_id"
  FROM "centres"
  WHERE "status" = 'active'
  ORDER BY "city_id", "created_at" ASC
) c
WHERE jsr."city_id" = c."city_id"
  AND jsr."centre_id" IS NULL;--> statement-breakpoint

DELETE FROM "join_student_registrations" WHERE "centre_id" IS NULL;--> statement-breakpoint

ALTER TABLE "join_student_registrations" ALTER COLUMN "centre_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "join_student_registrations"
  ADD CONSTRAINT "join_student_registrations_centre_id_centres_id_fk"
  FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "join_student_registrations" VALIDATE CONSTRAINT "join_student_registrations_centre_id_centres_id_fk";--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_join_student_registrations_centre"
  ON "join_student_registrations" ("centre_id");--> statement-breakpoint

-- Shared approval columns on all three tables
ALTER TABLE "join_student_registrations"
  ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending' NOT NULL,
  ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "reviewed_by" uuid,
  ADD COLUMN IF NOT EXISTS "rejection_reason" text,
  ADD COLUMN IF NOT EXISTS "provisioned_user_id" uuid,
  ADD COLUMN IF NOT EXISTS "provisioned_student_id" uuid;--> statement-breakpoint

ALTER TABLE "join_shikshak_registrations"
  ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending' NOT NULL,
  ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "reviewed_by" uuid,
  ADD COLUMN IF NOT EXISTS "rejection_reason" text,
  ADD COLUMN IF NOT EXISTS "provisioned_user_id" uuid;--> statement-breakpoint

ALTER TABLE "join_sanchalak_registrations"
  ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending' NOT NULL,
  ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "reviewed_by" uuid,
  ADD COLUMN IF NOT EXISTS "rejection_reason" text,
  ADD COLUMN IF NOT EXISTS "provisioned_user_id" uuid;--> statement-breakpoint

ALTER TABLE "join_student_registrations"
  ADD CONSTRAINT "join_student_registrations_reviewed_by_users_id_fk"
  FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "join_student_registrations" VALIDATE CONSTRAINT "join_student_registrations_reviewed_by_users_id_fk";--> statement-breakpoint

ALTER TABLE "join_student_registrations"
  ADD CONSTRAINT "join_student_registrations_provisioned_user_id_users_id_fk"
  FOREIGN KEY ("provisioned_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "join_student_registrations" VALIDATE CONSTRAINT "join_student_registrations_provisioned_user_id_users_id_fk";--> statement-breakpoint

ALTER TABLE "join_student_registrations"
  ADD CONSTRAINT "join_student_registrations_provisioned_student_id_students_id_fk"
  FOREIGN KEY ("provisioned_student_id") REFERENCES "students"("id") ON DELETE set null ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "join_student_registrations" VALIDATE CONSTRAINT "join_student_registrations_provisioned_student_id_students_id_fk";--> statement-breakpoint

ALTER TABLE "join_shikshak_registrations"
  ADD CONSTRAINT "join_shikshak_registrations_reviewed_by_users_id_fk"
  FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "join_shikshak_registrations" VALIDATE CONSTRAINT "join_shikshak_registrations_reviewed_by_users_id_fk";--> statement-breakpoint

ALTER TABLE "join_shikshak_registrations"
  ADD CONSTRAINT "join_shikshak_registrations_provisioned_user_id_users_id_fk"
  FOREIGN KEY ("provisioned_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "join_shikshak_registrations" VALIDATE CONSTRAINT "join_shikshak_registrations_provisioned_user_id_users_id_fk";--> statement-breakpoint

ALTER TABLE "join_sanchalak_registrations"
  ADD CONSTRAINT "join_sanchalak_registrations_reviewed_by_users_id_fk"
  FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "join_sanchalak_registrations" VALIDATE CONSTRAINT "join_sanchalak_registrations_reviewed_by_users_id_fk";--> statement-breakpoint

ALTER TABLE "join_sanchalak_registrations"
  ADD CONSTRAINT "join_sanchalak_registrations_provisioned_user_id_users_id_fk"
  FOREIGN KEY ("provisioned_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "join_sanchalak_registrations" VALIDATE CONSTRAINT "join_sanchalak_registrations_provisioned_user_id_users_id_fk";--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_join_student_registrations_status_centre"
  ON "join_student_registrations" ("status", "centre_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_join_student_registrations_status_city"
  ON "join_student_registrations" ("status", "city_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_join_shikshak_registrations_status_centre"
  ON "join_shikshak_registrations" ("status", "centre_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_join_sanchalak_registrations_status_centre"
  ON "join_sanchalak_registrations" ("status", "centre_id");
