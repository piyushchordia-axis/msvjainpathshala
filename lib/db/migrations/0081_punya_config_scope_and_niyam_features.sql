-- C3 + H3 — punya_configs uniqueness, and the two niyam feature keys the code
-- has always awarded under but which were never registered in the catalogue.
-- Every statement is guarded so already-migrated environments are no-ops.

-- ---------------------------------------------------------------------------
-- C3: one active points value per (feature, city).
--
-- punya_configs had only a NON-unique index on (feature_key, city_id), and
-- resolveNiyamAwardPoints read with .limit(1) and no ORDER BY — so with two
-- rows for the same feature the planner decided what a child was paid.
--
-- Two partial indexes, not one: Postgres treats NULLs as DISTINCT, so a plain
-- UNIQUE (feature_key, city_id) would happily allow unlimited *global* rows,
-- which is exactly the case that re-prices every city.
-- ---------------------------------------------------------------------------

-- Collapse pre-existing duplicates before the indexes can reject them: keep the
-- most recently updated row per (feature_key, city_id) and deactivate the rest.
-- Deactivating rather than deleting keeps the ledger's history readable.
UPDATE "punya_configs" pc
SET "is_active" = false, "updated_at" = now()
WHERE pc."is_active" = true
  AND EXISTS (
    SELECT 1 FROM "punya_configs" other
    WHERE other."feature_key" = pc."feature_key"
      AND other."is_active" = true
      AND other."city_id" IS NOT DISTINCT FROM pc."city_id"
      AND (other."updated_at", other."id") > (pc."updated_at", pc."id")
  );--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "punya_configs_feature_city_active_uq"
  ON "punya_configs" ("feature_key", "city_id")
  WHERE "city_id" IS NOT NULL AND "is_active" = true;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "punya_configs_feature_global_active_uq"
  ON "punya_configs" ("feature_key")
  WHERE "city_id" IS NULL AND "is_active" = true;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- punya_features.key had no unique index, so the bounds lookup
-- (`where key = ... limit 1`) was as non-deterministic as the config read.
-- ---------------------------------------------------------------------------
DELETE FROM "punya_features" pf
WHERE EXISTS (
  SELECT 1 FROM "punya_features" other
  WHERE other."key" = pf."key" AND other."id" > pf."id"
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "punya_features_key_uq"
  ON "punya_features" ("key");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- H3 (AT21): niyam_submission and niyam_badge are awarded at runtime
-- (niyam-submit.ts, niyam-approve.ts, niyam-badges.ts) but were absent from
-- punya_features. The parent ledger showed a raw key with no label, the
-- monthly-report join produced NULL, and neither had min/max bounds.
-- ---------------------------------------------------------------------------
INSERT INTO "punya_features" ("key", "label", "min_points", "max_points", "is_active")
SELECT 'niyam_submission', 'Niyam completed', 0, 1000, true
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_features" WHERE "key" = 'niyam_submission'
);--> statement-breakpoint

INSERT INTO "punya_features" ("key", "label", "min_points", "max_points", "is_active")
SELECT 'niyam_badge', 'Niyam streak badge', 0, 500, true
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_features" WHERE "key" = 'niyam_badge'
);
