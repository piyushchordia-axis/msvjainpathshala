-- Shivir module — the lifecycle the scanner was always missing.
--
-- The QR scanner shipped and worked; everything around it did not. This
-- migration makes four things representable for the first time:
--
--  1. REGISTRATION. shivir_registrations had no status, no registrar, and no
--     unique key — so `capacity` could never be enforced and the dashboard's
--     "Registered" count was structurally 0. Cancelling now flips a status
--     rather than deleting, so re-registering reuses one row instead of
--     stacking duplicates that each count against capacity.
--
--  2. VOLUNTEERS. shivir_volunteers had no assigner, no timestamp and no way to
--     revoke, so the "registered volunteer" arm of every authorization check
--     was unreachable dead code. Revocation is a timestamp, not a delete: the
--     scans a volunteer recorded still point at them.
--
--  3. RE-ENTRY. shivir_attendance_scans_session_student_kind_unique capped a
--     student at exactly one check_in per session for all time, which makes
--     SPEC 8.6 step 4 ("last is check_out -> insert new check_in") impossible.
--     It is dropped. Idempotency moves to client_op_id (AT19 ULID, char(26),
--     never uuid) plus a short re-scan window in the service — the transport
--     stays replay-safe without freezing the domain into one scan per kind.
--
--  4. BILINGUAL. name/description were single-language against CLAUDE.md.
--     Renamed to _en with nullable _hi alongside, matching courses and niyams.
--
-- Ordering note: every dedupe runs BEFORE the unique index it protects, so
-- index creation cannot fail on live data.

-- ── Registration status enum ────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'shivir_registration_status_enum' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "shivir_registration_status_enum" AS ENUM ('registered', 'cancelled');
  END IF;
END $$;--> statement-breakpoint

-- ── shivir_events: bilingual columns, soft delete, date-range guard ─────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shivir_events' AND column_name = 'name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shivir_events' AND column_name = 'name_en'
  ) THEN
    ALTER TABLE "shivir_events" RENAME COLUMN "name" TO "name_en";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shivir_events' AND column_name = 'description'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shivir_events' AND column_name = 'description_en'
  ) THEN
    ALTER TABLE "shivir_events" RENAME COLUMN "description" TO "description_en";
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "shivir_events" ADD COLUMN IF NOT EXISTS "name_hi" text;--> statement-breakpoint
ALTER TABLE "shivir_events" ADD COLUMN IF NOT EXISTS "description_hi" text;--> statement-breakpoint
ALTER TABLE "shivir_events" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint

-- The publish announcement is an unbounded fan-out to every parent in the city,
-- so it must fire exactly once per shivir. Claiming this column is what makes
-- that true across a republish and across a retried queue job.
ALTER TABLE "shivir_events" ADD COLUMN IF NOT EXISTS "announced_at" timestamp with time zone;--> statement-breakpoint

-- Back-mark everything already published. These shivirs have been live for a
-- while and their families already know; without this the first edit made to
-- any of them after deploy would announce the whole back catalogue at once.
UPDATE "shivir_events" SET "announced_at" = now()
WHERE "announced_at" IS NULL AND "is_published";--> statement-breakpoint

-- NOT VALID on purpose: an existing inverted range is bad data, but failing the
-- whole migration over it would be worse. New and updated rows are checked;
-- the API rejects inverted ranges with a 422 before they get here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shivir_events_end_gte_start') THEN
    ALTER TABLE "shivir_events"
      ADD CONSTRAINT "shivir_events_end_gte_start" CHECK ("end_date" >= "start_date") NOT VALID;
  END IF;
END $$;--> statement-breakpoint

-- ── shivir_registrations: status, registrar, one row per (shivir, student) ──
ALTER TABLE "shivir_registrations"
  ADD COLUMN IF NOT EXISTS "status" "shivir_registration_status_enum" NOT NULL DEFAULT 'registered';--> statement-breakpoint
ALTER TABLE "shivir_registrations" ADD COLUMN IF NOT EXISTS "registered_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "shivir_registrations"
  ADD COLUMN IF NOT EXISTS "registered_at" timestamp with time zone NOT NULL DEFAULT now();--> statement-breakpoint
ALTER TABLE "shivir_registrations" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shivir_registrations_registered_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "shivir_registrations"
      ADD CONSTRAINT "shivir_registrations_registered_by_user_id_users_id_fk"
      FOREIGN KEY ("registered_by_user_id") REFERENCES "public"."users"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

-- Collapse duplicates (keep the newest) before the unique index exists.
DELETE FROM "shivir_registrations" a
USING "shivir_registrations" b
WHERE a."shivir_id" = b."shivir_id"
  AND a."student_id" = b."student_id"
  AND (b."created_at", b."id") > (a."created_at", a."id");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "shivir_registrations_shivir_student_uq"
  ON "shivir_registrations" ("shivir_id", "student_id");--> statement-breakpoint

-- ── shivir_volunteers: assignment provenance + revocation ───────────────────
ALTER TABLE "shivir_volunteers" ADD COLUMN IF NOT EXISTS "assigned_by" uuid;--> statement-breakpoint
ALTER TABLE "shivir_volunteers"
  ADD COLUMN IF NOT EXISTS "assigned_at" timestamp with time zone NOT NULL DEFAULT now();--> statement-breakpoint
ALTER TABLE "shivir_volunteers" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp with time zone;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shivir_volunteers_assigned_by_users_id_fk'
  ) THEN
    ALTER TABLE "shivir_volunteers"
      ADD CONSTRAINT "shivir_volunteers_assigned_by_users_id_fk"
      FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

-- Revoke the older duplicates rather than deleting them: the row is the record
-- that this person could act on this shivir at that time.
UPDATE "shivir_volunteers" a
SET "revoked_at" = now(), "updated_at" = now()
WHERE a."revoked_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "shivir_volunteers" b
    WHERE b."shivir_id" = a."shivir_id" AND b."user_id" = a."user_id"
      AND b."revoked_at" IS NULL AND (b."created_at", b."id") > (a."created_at", a."id")
  );--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "shivir_volunteers_active_shivir_user_uq"
  ON "shivir_volunteers" ("shivir_id", "user_id") WHERE "revoked_at" IS NULL;--> statement-breakpoint

-- ── shivir_sessions: day number and times (SPEC 5.11) ───────────────────────
ALTER TABLE "shivir_sessions" ADD COLUMN IF NOT EXISTS "day_number" integer;--> statement-breakpoint
ALTER TABLE "shivir_sessions" ADD COLUMN IF NOT EXISTS "start_time" time;--> statement-breakpoint
ALTER TABLE "shivir_sessions" ADD COLUMN IF NOT EXISTS "end_time" time;--> statement-breakpoint

UPDATE "shivir_sessions" s
SET "day_number" = r.rn
FROM (
  SELECT "id",
         row_number() OVER (PARTITION BY "shivir_id" ORDER BY "session_date", "created_at", "id") AS rn
  FROM "shivir_sessions"
) r
WHERE s."id" = r."id" AND s."day_number" IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "shivir_sessions_shivir_day_uq"
  ON "shivir_sessions" ("shivir_id", "day_number") WHERE "day_number" IS NOT NULL;--> statement-breakpoint

-- ── shivir_attendance_scans: the re-entry fix ──────────────────────────────
ALTER TABLE "shivir_attendance_scans" ADD COLUMN IF NOT EXISTS "shivir_id" uuid;--> statement-breakpoint

UPDATE "shivir_attendance_scans" s
SET "shivir_id" = ss."shivir_id"
FROM "shivir_sessions" ss
WHERE ss."id" = s."shivir_session_id" AND s."shivir_id" IS NULL;--> statement-breakpoint

ALTER TABLE "shivir_attendance_scans" ALTER COLUMN "shivir_id" SET NOT NULL;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shivir_attendance_scans_shivir_id_shivir_events_id_fk'
  ) THEN
    ALTER TABLE "shivir_attendance_scans"
      ADD CONSTRAINT "shivir_attendance_scans_shivir_id_shivir_events_id_fk"
      FOREIGN KEY ("shivir_id") REFERENCES "public"."shivir_events"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "shivir_attendance_scans" ADD COLUMN IF NOT EXISTS "client_op_id" char(26);--> statement-breakpoint
ALTER TABLE "shivir_attendance_scans"
  ADD COLUMN IF NOT EXISTS "device_offline" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "shivir_attendance_scans"
  ADD COLUMN IF NOT EXISTS "was_registered" boolean NOT NULL DEFAULT false;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shivir_attendance_scans_client_op_id_ulid_check'
  ) THEN
    ALTER TABLE "shivir_attendance_scans"
      ADD CONSTRAINT "shivir_attendance_scans_client_op_id_ulid_check"
      CHECK ("client_op_id" IS NULL OR "client_op_id" ~ '^[0-9A-HJKMNP-TV-Z]{26}$');
  END IF;
END $$;--> statement-breakpoint

-- NOT partial. Postgres treats NULLs as distinct in a unique index, so a
-- `WHERE client_op_id IS NOT NULL` predicate would buy nothing — and a partial
-- index cannot be inferred by a bare `ON CONFLICT (client_op_id)`, which is
-- exactly how the scan service claims idempotency for the offline transport.
CREATE UNIQUE INDEX IF NOT EXISTS "shivir_attendance_scans_client_op_id_uq"
  ON "shivir_attendance_scans" ("client_op_id");--> statement-breakpoint

-- The key that made re-entry impossible. Dropped last, after client_op_id is in
-- place, so the table is never without an idempotency anchor.
DROP INDEX IF EXISTS "shivir_attendance_scans_session_student_kind_unique";--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_shivir_attendance_scans_shivir_scanned"
  ON "shivir_attendance_scans" ("shivir_id", "scanned_at");--> statement-breakpoint

-- Hot path for the in_out toggle: this student's last scan in this session.
CREATE INDEX IF NOT EXISTS "idx_shivir_attendance_scans_session_student_recent"
  ON "shivir_attendance_scans" ("shivir_session_id", "student_id", "scanned_at");--> statement-breakpoint

-- ── AT28's documented Punya path (SPEC 13.4: "msv_shivir variable") ─────────
-- The feature key existed only in a code comment and a mobile label map, so an
-- award had to fall back to generic manual seva, losing the catalogue's bounds.
INSERT INTO "punya_features" ("key", "label", "min_points", "max_points", "is_active")
SELECT 'msv_shivir', 'Shivir participation', 0, 500, true
WHERE NOT EXISTS (SELECT 1 FROM "punya_features" WHERE "key" = 'msv_shivir');
