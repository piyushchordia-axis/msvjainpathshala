-- M3 — the four SPEC 5.7 columns punya_features never had.
--
-- Every resolver fell back to `max_points` as a feature's normal value: a
-- CEILING used as the default. That is why `attendance` (max 10) happened to
-- pay 10 and looked correct, and why nothing could express "this award requires
-- a reason" as data (BRD 7.2) or "only a human may grant this".
--
-- default_points is backfilled from max_points so behaviour is unchanged on the
-- day this ships; it just becomes possible to say something different.
ALTER TABLE "punya_features" ADD COLUMN IF NOT EXISTS "default_points" integer;--> statement-breakpoint
ALTER TABLE "punya_features" ADD COLUMN IF NOT EXISTS "is_manual" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "punya_features" ADD COLUMN IF NOT EXISTS "requires_reason" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "punya_features" ADD COLUMN IF NOT EXISTS "scope" text NOT NULL DEFAULT 'global';--> statement-breakpoint

UPDATE "punya_features"
   SET "default_points" = COALESCE("max_points", "min_points", 0)
 WHERE "default_points" IS NULL;--> statement-breakpoint

-- manual_award is the one existing key a human grants by hand, and BRD 7.2
-- makes the reason mandatory for it.
UPDATE "punya_features"
   SET "is_manual" = true, "requires_reason" = true
 WHERE "key" = 'manual_award';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AT23 — the tier ladder is CONFIGURATION, not a code constant.
--
-- "These live in CONFIGURATION alongside punya_features, not as code constants
-- — adjustable without a migration." It was TIER_THRESHOLDS in enums.ts, so
-- every adjustment needed a deploy, and the same numbers were re-inlined into
-- three separate SQL CASE ladders (creditBalance, creditBalancesFromReturned,
-- punya.reconcile) with nothing asserting they agreed.
--
-- Values are CLAUDE.md's, which is authoritative over SPEC and BRD. BRD 7.4
-- disagrees (0/200/500/1000/2000); that conflict is recorded, not resolved
-- here, because re-tiering every student is a business decision.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "punya_tier_thresholds" (
  "tier" "tier_enum" PRIMARY KEY,
  "min_points" integer NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

INSERT INTO "punya_tier_thresholds" ("tier", "min_points")
SELECT * FROM (VALUES
  ('jigyasu'::"tier_enum", 0),
  ('shravak'::"tier_enum", 101),
  ('sadhak'::"tier_enum", 501),
  ('shraman'::"tier_enum", 1501),
  ('tirthankar'::"tier_enum", 5001)
) AS v("tier", "min_points")
WHERE NOT EXISTS (SELECT 1 FROM "punya_tier_thresholds");
