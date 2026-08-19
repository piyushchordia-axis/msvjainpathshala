-- M1 / M2 — the MSV parallel track had no data model at all.
--
-- SPEC 5.7 specifies city_id / centre_id / batch_id denormalised onto
-- punya_transactions "for fast leaderboard queries", plus is_msv_track for the
-- parallel MSV leaderboard, and msv_points on punya_balances. None existed, so
-- BRD 7.5's MSV tier labels and 7.6's MSV leaderboard had nothing to build on,
-- and every scoped leaderboard would have had to join students -> centres ->
-- cities on every read.
--
-- awarded_at is separate from created_at on purpose: created_at is when the row
-- was WRITTEN, which for an offline sync or a catch-up job is not when the
-- child earned it. Backfilled to created_at, so nothing moves today.
--
-- The ledger is append-only at the database (0090), so the backfill declares
-- itself. Transaction-scoped: drizzle-kit wraps each migration in BEGIN/COMMIT,
-- so this cannot leak past this file.
SELECT set_config('jp.ledger_maintenance', 'on', true);--> statement-breakpoint

ALTER TABLE "punya_transactions" ADD COLUMN IF NOT EXISTS "city_id" uuid;--> statement-breakpoint
ALTER TABLE "punya_transactions" ADD COLUMN IF NOT EXISTS "centre_id" uuid;--> statement-breakpoint
ALTER TABLE "punya_transactions" ADD COLUMN IF NOT EXISTS "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "punya_transactions" ADD COLUMN IF NOT EXISTS "is_msv_track" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "punya_transactions" ADD COLUMN IF NOT EXISTS "awarded_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "punya_balances" ADD COLUMN IF NOT EXISTS "msv_points" integer NOT NULL DEFAULT 0;--> statement-breakpoint
-- BRD 7.5's tier celebration needs to know WHEN, not just what.
ALTER TABLE "punya_balances" ADD COLUMN IF NOT EXISTS "tier_reached_at" timestamp with time zone;--> statement-breakpoint

-- Backfill geography from the student's current placement. This is a snapshot,
-- not a history: a child who transfers centres keeps the old rows pointing at
-- where they were when they earned them, which is what a per-centre leaderboard
-- for a past month has to mean.
UPDATE "punya_transactions" t
   SET "city_id"   = c."city_id",
       "centre_id" = s."centre_id",
       "batch_id"  = s."batch_id"
  FROM "students" s
  LEFT JOIN "centres" c ON c."id" = s."centre_id"
 WHERE s."id" = t."student_id"
   AND t."centre_id" IS NULL;--> statement-breakpoint

UPDATE "punya_transactions"
   SET "awarded_at" = "created_at"
 WHERE "awarded_at" IS NULL;--> statement-breakpoint

-- MSV membership as it stands now. Historical rows are marked by the student's
-- CURRENT enrolment because there is no per-award record of it — the honest
-- alternative would be leaving every historical row false, which would make the
-- MSV leaderboard silently empty for its first month.
UPDATE "punya_transactions" t
   SET "is_msv_track" = true
 WHERE EXISTS (
   SELECT 1 FROM "msv_enrolments" m
    WHERE m."student_id" = t."student_id"
      AND m."status" = 'approved'
 );--> statement-breakpoint

UPDATE "punya_balances" b
   SET "msv_points" = COALESCE(x."total", 0)
  FROM (
    SELECT "student_id", SUM("points")::int AS "total"
      FROM "punya_transactions"
     WHERE "is_msv_track" = true
     GROUP BY "student_id"
  ) x
 WHERE x."student_id" = b."student_id";--> statement-breakpoint

-- Leaderboard reads are "this scope, this month", so the range column leads.
CREATE INDEX IF NOT EXISTS "idx_punya_tx_city_created"
  ON "punya_transactions" ("city_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_punya_tx_centre_created"
  ON "punya_transactions" ("centre_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_punya_tx_batch_created"
  ON "punya_transactions" ("batch_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_punya_tx_msv_created"
  ON "punya_transactions" ("created_at")
  WHERE "is_msv_track" = true;
