-- Gallery curation: explicit featuring replaces auto-publish to Punya Wall.
--
-- Flag meanings (keep distinct):
--   is_public        — not soft-hidden by an admin
--   featured_gallery — appears on the public Punya Wall
--   featured_home    — appears in the logged-in home dashboard carousel
-- Featuring NEVER overrides parent gallery_visibility_opt_in (Q6).

-- Rename existing pin flag; values survive (then backfill clears them).
ALTER TABLE "gallery_items" RENAME COLUMN "is_featured" TO "featured_gallery";--> statement-breakpoint

ALTER TABLE "gallery_items" ADD COLUMN IF NOT EXISTS "featured_home" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD COLUMN IF NOT EXISTS "featured_at" timestamptz;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD COLUMN IF NOT EXISTS "featured_by" uuid;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD COLUMN IF NOT EXISTS "city_id" uuid;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "gallery_items"
    ADD CONSTRAINT "gallery_items_featured_by_users_id_fk"
    FOREIGN KEY ("featured_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "gallery_items"
    ADD CONSTRAINT "gallery_items_city_id_cities_id_fk"
    FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- Wall empty on deploy until admins curate (intended).
UPDATE "gallery_items"
SET "featured_gallery" = false,
    "featured_home" = false,
    "featured_at" = NULL,
    "featured_by" = NULL;--> statement-breakpoint

-- Denormalise city from the student's centre for hot public / queue filters.
UPDATE "gallery_items" gi
SET "city_id" = c."city_id"
FROM "students" s
JOIN "centres" c ON c."id" = s."centre_id"
WHERE gi."student_id" = s."id"
  AND gi."student_id" IS NOT NULL
  AND gi."city_id" IS NULL;--> statement-breakpoint

-- Alternative for admin-uploaded items (created_by set). Uncomment to keep them
-- visible on the wall rather than re-curating after deploy. Trade-off: those
-- rows were a deliberate curation decision via POST /v1/gallery/admin, but
-- re-featuring everything keeps the empty-wall deploy story consistent.
-- UPDATE gallery_items SET featured_gallery = true WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_gallery_items_featured_gallery_created"
  ON "gallery_items" ("featured_gallery", "created_at" DESC)
  WHERE "deleted_at" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_gallery_items_featured_home_created"
  ON "gallery_items" ("featured_home", "created_at" DESC)
  WHERE "deleted_at" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_gallery_items_city_created"
  ON "gallery_items" ("city_id", "created_at" DESC);--> statement-breakpoint
