-- Refresh-token families + curriculum kind constraint.
--
-- device_sessions rotated `refresh_token_hash` in place, so a replayed old token
-- simply missed the lookup and 401'd while the thief's rolling session stayed
-- alive. Refresh now REVOKES the current row and inserts a successor sharing its
-- `family_id`, so every consumed token stays on record: presenting a revoked
-- hash whose family still has live rows is proof a second copy exists.
--
-- Keeping full history (rather than only the last superseded hash) means
-- detection does not depend on how many times the real user has rotated since
-- the theft. Growth is bounded by the existing auth.session.cleanup cron, which
-- already deletes expired rows and revoked rows older than 30 days.
--
-- Existing rows each become their own family via the column default; no backfill
-- is needed because a family only matters from its first rotation on.
--
-- All statements are guarded so environments that gained these out-of-band are
-- untouched, matching 0068/0069.

ALTER TABLE "device_sessions"
  ADD COLUMN IF NOT EXISTS "family_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint

-- The 5-device cap counts live sessions per user on every OTP verify.
CREATE INDEX IF NOT EXISTS "idx_device_sessions_user_active"
  ON "device_sessions" ("user_id", "revoked_at", "expires_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_device_sessions_family"
  ON "device_sessions" ("family_id");--> statement-breakpoint

-- Q2 — courses.kind was free-form text, so `kind:'MSV'` stored as an inert
-- orphan that the service-layer super_admin check (an exact 'msv' compare)
-- never saw. NOT VALID so pre-existing rows do not block the migration; the
-- constraint still applies to every INSERT and UPDATE from here on.
DO $$ BEGIN
  ALTER TABLE "courses"
    ADD CONSTRAINT "courses_kind_check" CHECK ("kind" IN ('standard', 'msv')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
