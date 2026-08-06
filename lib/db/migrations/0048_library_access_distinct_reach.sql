-- Distinct-reach access log: one row per (item, user). Re-opens bump
-- access_count / last_accessed_at instead of appending forever.

ALTER TABLE "library_access_logs"
  ADD COLUMN IF NOT EXISTS "last_accessed_at" timestamptz;--> statement-breakpoint

ALTER TABLE "library_access_logs"
  ADD COLUMN IF NOT EXISTS "access_count" integer NOT NULL DEFAULT 1;--> statement-breakpoint

UPDATE "library_access_logs"
  SET "last_accessed_at" = "accessed_at"
  WHERE "last_accessed_at" IS NULL;--> statement-breakpoint

ALTER TABLE "library_access_logs"
  ALTER COLUMN "last_accessed_at" SET DEFAULT now();--> statement-breakpoint

ALTER TABLE "library_access_logs"
  ALTER COLUMN "last_accessed_at" SET NOT NULL;--> statement-breakpoint

-- Collapse duplicates: keep the earliest row per (item, user), fold open counts.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY library_item_id, user_id
      ORDER BY accessed_at ASC NULLS LAST, created_at ASC NULLS LAST, id ASC
    ) AS rn,
    COUNT(*) OVER (PARTITION BY library_item_id, user_id) AS n,
    MAX(accessed_at) OVER (PARTITION BY library_item_id, user_id) AS last_at
  FROM library_access_logs
  WHERE user_id IS NOT NULL AND library_item_id IS NOT NULL
)
UPDATE library_access_logs l
SET
  access_count = ranked.n,
  last_accessed_at = COALESCE(ranked.last_at, l.accessed_at)
FROM ranked
WHERE l.id = ranked.id AND ranked.rn = 1;--> statement-breakpoint

DELETE FROM library_access_logs l
USING (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY library_item_id, user_id
      ORDER BY accessed_at ASC NULLS LAST, created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM library_access_logs
  WHERE user_id IS NOT NULL AND library_item_id IS NOT NULL
) d
WHERE l.id = d.id AND d.rn > 1;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_library_access_logs_item_user"
  ON "library_access_logs" ("library_item_id", "user_id")
  WHERE "user_id" IS NOT NULL;
