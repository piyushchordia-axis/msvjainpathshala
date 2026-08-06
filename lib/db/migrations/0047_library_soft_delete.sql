-- Soft-delete for library_items so DELETE no longer cascades away access history.
-- library_access_logs.library_item_id becomes nullable + ON DELETE SET NULL so a
-- future hard purge cannot take usage rows with it.

ALTER TABLE "library_items" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_library_items_alive" ON "library_items" ("created_at" DESC)
  WHERE "deleted_at" IS NULL;--> statement-breakpoint

ALTER TABLE "library_access_logs"
  DROP CONSTRAINT IF EXISTS "library_access_logs_library_item_id_library_items_id_fk";--> statement-breakpoint

ALTER TABLE "library_access_logs"
  ALTER COLUMN "library_item_id" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "library_access_logs"
  ADD CONSTRAINT "library_access_logs_library_item_id_library_items_id_fk"
  FOREIGN KEY ("library_item_id") REFERENCES "library_items"("id") ON DELETE SET NULL;
