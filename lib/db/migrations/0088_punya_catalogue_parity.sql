-- C2 — the `attendance` Punya feature was never registered by a migration.
--
-- ATTENDANCE_FEATURE_KEY = 'attendance' (attendance-points.ts) resolves
-- city config -> global config -> punya_features bounds -> 0. No migration in
-- the 87-file set inserted any of those three, so on a migration-built database
-- resolveAttendanceAwardPointsForCity returned 0, awardValueForStatus returned
-- 0, and attendance-mark.ts short-circuited on `amount <= 0` WITHOUT writing a
-- ledger row. Marking a student present awarded nothing, silently.
--
-- It was invisible in development because seed.ts inserts the key -- and the
-- seed TRUNCATEs punya_features first, so the two sources of truth had drifted
-- in both directions (seed added `attendance`, dropped `attendance_streak`).
-- Step 16's exit criterion -- "marking a student present awards 10 Punya" --
-- did not hold on any database built the way production is built.
--
-- 10 points matches the seed value and punya_features.max_points, so a
-- migrate-then-seed database and a migrate-only database now agree.
-- Guarded throughout: already-migrated environments are a no-op.

INSERT INTO "punya_features" ("key", "label", "min_points", "max_points", "is_active")
SELECT 'attendance', 'Attendance', 0, 10, true
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_features" WHERE "key" = 'attendance'
);--> statement-breakpoint

INSERT INTO "punya_configs" ("feature_key", "points", "city_id", "is_active")
SELECT 'attendance', 10, NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_configs"
  WHERE "feature_key" = 'attendance' AND "city_id" IS NULL
);
