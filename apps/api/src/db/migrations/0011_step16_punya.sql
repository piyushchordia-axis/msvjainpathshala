-- Step 16 — Punya Engine & Leaderboards
--
-- Three deltas:
--   1. Seed additional `punya_features` rows the engine relies on at runtime
--      (manual seva variants, tier-upgrade attribution, leaderboard top-N
--      reward, niyam approval) — all with conservative min_points/max_points
--      bounds so super_admin can override later via UPDATE.
--   2. Backfill `min_points` / `max_points` on the rows seeded in 0004 +
--      0008 so the manual-award validator can enforce ranges without falling
--      back to "no bounds = anything goes". The default bound is a 0.5x..3x
--      envelope around `default_points` for non-manual events, and a 1..200
--      envelope for `manual_seva` (the only `is_manual=true` row today).
--   3. Add the index `idx_punya_centre_awarded` so centre-scope leaderboards
--      hit an index rather than relying on a partition scan via the existing
--      `idx_punya_city_awarded`. SPEC §5.7 mentions per-batch / per-centre
--      leaderboards explicitly.
--
-- All blocks are idempotent (`ON CONFLICT (key) DO UPDATE` / `IF NOT EXISTS`).

-- ===== 1. Seed additional Punya features ===================================
INSERT INTO "punya_features"
  ("key", "default_points", "is_manual", "requires_reason", "scope",
   "min_points", "max_points", "created_at", "updated_at")
VALUES
  -- Niyam approval — points are awarded by the Niyam pipeline (Step 17) but
  -- the catalogue row is needed so the manual-award screen can target it for
  -- "missed niyam credit" corrections.
  ('niyam_approved',          15, false, false, 'global', 5,  50,  now(), now()),
  -- Manual seva — wide envelope so a city_admin can credit a child for
  -- helping clean the centre, etc. requires_reason = true.
  ('manual_seva_small',       10, true,  true,  'global', 1,  25,  now(), now()),
  ('manual_seva_medium',      25, true,  true,  'global', 10, 75,  now(), now()),
  ('manual_seva_large',       50, true,  true,  'global', 25, 200, now(), now()),
  -- Quiz / exam outcomes — same pattern; specific exam wiring lands in
  -- Steps 19/20 but the engine can already award against these keys.
  ('quiz_participation',      10, false, false, 'global', 5,  20,  now(), now()),
  ('quiz_top_score',          30, false, false, 'global', 15, 75,  now(), now()),
  ('exam_completion',         20, false, false, 'global', 10, 50,  now(), now()),
  -- Leaderboard monthly award (winner of batch / centre / city / national).
  ('leaderboard_monthly_top', 75, false, false, 'global', 25, 250, now(), now())
ON CONFLICT ("key") DO UPDATE
  SET min_points = COALESCE(EXCLUDED.min_points, punya_features.min_points),
      max_points = COALESCE(EXCLUDED.max_points, punya_features.max_points),
      updated_at = now();--> statement-breakpoint

-- ===== 2. Backfill bounds for rows seeded in 0004 / 0008 ====================
-- 0004 seeded 8 rows + 0008 seeded 5 attendance-streak rows. We give each one
-- a sensible envelope so the manual-award validator has something to range-
-- check against. The envelope is intentionally permissive (0.5x..3x of
-- default for non-manual; 1..200 for manual_seva) — super_admin can tighten
-- per-city via punya_configs.{min,max}_points.
UPDATE "punya_features"
   SET min_points = GREATEST(1, FLOOR(default_points * 0.5)::int),
       max_points = (default_points * 3)::int,
       updated_at = now()
 WHERE min_points IS NULL
   AND is_manual = false
   AND default_points > 0;--> statement-breakpoint

UPDATE "punya_features"
   SET min_points = 1,
       max_points = 200,
       updated_at = now()
 WHERE key = 'manual_seva'
   AND (min_points IS NULL OR max_points IS NULL);--> statement-breakpoint

-- ===== 3. Centre-scope index for leaderboards ==============================
-- The centre leaderboard ZSET refresh sums the last 30 days of awards per
-- centre. Without this index Postgres falls back to the city-scoped index
-- and re-filters — fine at low volume but quadratic at city scale.
CREATE INDEX IF NOT EXISTS "idx_punya_centre_awarded"
  ON "punya_transactions" ("centre_id", "awarded_at" DESC)
  WHERE "centre_id" IS NOT NULL;
