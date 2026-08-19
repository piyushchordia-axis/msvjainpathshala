-- SPEC 6.9 — POST /v1/admin/batches/:id/leaderboard-mode, the tier-display
-- toggle for younger ages.
--
-- BRD 7.6 wants a ranked board; 7.5 wants tiers. For a Bal batch of
-- eight-year-olds a public ordinal ranking of children is a different thing
-- from a tier badge, and which one a centre wants is a pastoral judgement, not
-- a platform-wide default. 'rank' preserves today's behaviour for every
-- existing batch; 'tier' hides the ordinal and shows the tier instead.
CREATE TYPE "public"."leaderboard_mode_enum" AS ENUM('rank', 'tier');--> statement-breakpoint

ALTER TABLE "batches"
  ADD COLUMN IF NOT EXISTS "leaderboard_mode" "leaderboard_mode_enum"
  NOT NULL DEFAULT 'rank';
