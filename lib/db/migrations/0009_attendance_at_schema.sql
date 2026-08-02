-- AT1–AT31 attendance / session / offline-sync schema (populated-table safe).
-- Generated via `pnpm db:generate` (drizzle-kit), then rewritten for:
--   • rename (not drop/add) of sessions.session_date → scheduled_date
--   • three-step attendance.session_date backfill
--   • session_cancellations → sessions cancel columns before DROP
--   • dedupe before UNIQUE (batch_id, scheduled_date)
-- Snapshot: meta/0009_snapshot.json (from generate; matches @workspace/db schema).

CREATE TYPE "public"."sync_op_status_enum" AS ENUM('success', 'duplicate', 'conflict', 'failed');--> statement-breakpoint

/* centres: rename radius column + AT13 default/data migration */
ALTER TABLE "centres" RENAME COLUMN "gps_radius_m" TO "gps_radius_meters";--> statement-breakpoint
ALTER TABLE "centres" ALTER COLUMN "gps_radius_meters" SET DEFAULT 250;--> statement-breakpoint
-- Rows holding 150 or 500 are the OLD DEFAULTS, not deliberate overrides.
UPDATE "centres" SET "gps_radius_meters" = 250 WHERE "gps_radius_meters" IN (150, 500);--> statement-breakpoint

/* sessions: rename calendar date column (preserve 56 rows) */
ALTER TABLE "sessions" RENAME COLUMN "session_date" TO "scheduled_date";--> statement-breakpoint

ALTER TABLE "sessions" ADD COLUMN "scheduled_start_time" time;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "scheduled_end_time" time;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "gps_flagged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "gps_unverified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "unscheduled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "auto_checked_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "no_show_flagged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "shikshak_user_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "check_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "check_in_lat" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "check_in_lng" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "check_in_distance_m" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "check_in_accuracy_m" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "check_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "check_out_lat" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "check_out_lng" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "check_out_distance_m" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "check_out_accuracy_m" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "cancellation_by" uuid;--> statement-breakpoint

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_shikshak_user_id_users_id_fk" FOREIGN KEY ("shikshak_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_cancellation_by_users_id_fk" FOREIGN KEY ("cancellation_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

/* Fold session_cancellations into sessions cancel columns, then drop the table. */
UPDATE "sessions" AS s
SET
  "cancelled_at" = COALESCE(s."cancelled_at", sc."created_at"),
  "cancellation_reason" = COALESCE(s."cancellation_reason", sc."reason"),
  "cancellation_by" = COALESCE(s."cancellation_by", sc."cancelled_by"),
  "status" = 'cancelled'
FROM "session_cancellations" AS sc
WHERE sc."session_id" = s."id";--> statement-breakpoint

DROP TABLE "session_cancellations" CASCADE;--> statement-breakpoint

/*
 * UNIQUE (batch_id, scheduled_date) — AT7.
 * Dev has duplicate (batch_id, date) pairs from tests/seed; keep the earliest
 * row, re-point non-conflicting attendance, delete the rest.
 */
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY batch_id, scheduled_date ORDER BY created_at ASC, id ASC) AS rn
  FROM sessions
),
dupes AS (
  SELECT id FROM ranked WHERE rn > 1
),
keepers AS (
  SELECT keep.id AS keep_id, dupe.id AS dupe_id
  FROM sessions dupe
  INNER JOIN sessions keep
    ON keep.batch_id = dupe.batch_id
   AND keep.scheduled_date = dupe.scheduled_date
  INNER JOIN ranked rk ON rk.id = keep.id AND rk.rn = 1
  WHERE dupe.id IN (SELECT id FROM dupes)
)
UPDATE attendance AS a
SET session_id = k.keep_id
FROM keepers k
WHERE a.session_id = k.dupe_id
  AND NOT EXISTS (
    SELECT 1 FROM attendance a2
    WHERE a2.session_id = k.keep_id AND a2.student_id = a.student_id
  );--> statement-breakpoint

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY batch_id, scheduled_date ORDER BY created_at ASC, id ASC) AS rn
  FROM sessions
),
dupes AS (
  SELECT id FROM ranked WHERE rn > 1
)
DELETE FROM attendance WHERE session_id IN (SELECT id FROM dupes);--> statement-breakpoint

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY batch_id, scheduled_date ORDER BY created_at ASC, id ASC) AS rn
  FROM sessions
)
DELETE FROM sessions WHERE id IN (SELECT id FROM ranked WHERE rn > 1);--> statement-breakpoint

CREATE UNIQUE INDEX "sessions_batch_id_scheduled_date_unique" ON "sessions" USING btree ("batch_id","scheduled_date");--> statement-breakpoint

/* students streak columns (code already writes these; column was missing) */
ALTER TABLE "students" ADD COLUMN "attendance_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "attendance_streak_updated_at" timestamp with time zone;--> statement-breakpoint

/* attendance: revision + denormalised session_date (three-step) + client_op_id ULID */
ALTER TABLE "attendance" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint

-- Step 1: nullable session_date
ALTER TABLE "attendance" ADD COLUMN "session_date" date;--> statement-breakpoint

-- Step 2: backfill from sessions.scheduled_date
UPDATE "attendance" AS a
SET "session_date" = s."scheduled_date"
FROM "sessions" AS s
WHERE s."id" = a."session_id" AND a."session_date" IS NULL;--> statement-breakpoint

-- Step 3: enforce NOT NULL
ALTER TABLE "attendance" ALTER COLUMN "session_date" SET NOT NULL;--> statement-breakpoint

/*
 * client_op_id: char(26) ULID (AT19).
 * MIGRATION HAZARD: if this column previously stored 36-char UUIDs, those values
 * would fail the ULID CHECK. Historical offline op ids have no ongoing value —
 * NULL them out before adding the constraint. On this database the column did
 * not exist yet (greenfield char(26)), so there are no UUID values to clear;
 * the NULL step is retained for forward-compatible / replay safety.
 */
ALTER TABLE "attendance" ADD COLUMN "client_op_id" char(26);--> statement-breakpoint
UPDATE "attendance" SET "client_op_id" = NULL
WHERE "client_op_id" IS NOT NULL
  AND "client_op_id" !~ '^[0-9A-HJKMNP-TV-Z]{26}$';--> statement-breakpoint

ALTER TABLE "attendance" ADD CONSTRAINT "attendance_client_op_id_ulid_check" CHECK ("attendance"."client_op_id" is null or "attendance"."client_op_id" ~ '^[0-9A-HJKMNP-TV-Z]{26}$');--> statement-breakpoint

CREATE UNIQUE INDEX "attendance_client_op_id_unique" ON "attendance" USING btree ("client_op_id") WHERE "attendance"."client_op_id" is not null;--> statement-breakpoint

-- Replace partial absent index purpose: order by session_date without joining sessions.
DROP INDEX IF EXISTS "idx_attendance_student_absent";--> statement-breakpoint
CREATE INDEX "idx_attendance_student_absent_by_date" ON "attendance" USING btree ("student_id","session_date") WHERE "attendance"."status" = 'absent';--> statement-breakpoint

CREATE TABLE "absence_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"parent_user_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "absence_notifications_end_gte_start" CHECK ("absence_notifications"."end_date" >= "absence_notifications"."start_date")
);
--> statement-breakpoint
CREATE TABLE "sync_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"submission_op_id" char(26) NOT NULL,
	"op_kind" text NOT NULL,
	"request_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_payload" jsonb,
	"status" "sync_op_status_enum" DEFAULT 'success' NOT NULL,
	"error" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_operations_submission_op_id_ulid_check" CHECK ("sync_operations"."submission_op_id" ~ '^[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint

ALTER TABLE "absence_notifications" ADD CONSTRAINT "absence_notifications_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_notifications" ADD CONSTRAINT "absence_notifications_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "absence_notifications_student_range_unique" ON "absence_notifications" USING btree ("student_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "idx_absence_notifications_student" ON "absence_notifications" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_operations_user_submission_unique" ON "sync_operations" USING btree ("user_id","submission_op_id");
