-- Section 17 v3 §17.1.3 / §17.9 / §17.11.2 — PDF + external-link modalities,
-- and the access log they report into.
--
-- Three parts:
--
-- 1. pdf_url. 0073 added pdf_asset_id as a bare uuid reserved for SPEC's
--    media_assets table, which does not exist in this monorepo. A PDF still has
--    to be reachable, and this build stores media by URL (audio_url, not v2's
--    audio_asset_id), so PDFs follow the same shape. pdf_asset_id stays
--    reserved and unused; the modality CHECK accepts either, so nothing has to
--    change again when media_assets lands.
--
-- 2. draft_* mirrors for every PDF/external column. Without them a PDF upload
--    or a pasted link would go straight to the live row, skipping the review
--    gate every other library field passes through and never bumping
--    content_version — so offline clients would keep serving the old file.
--
-- 3. library_access_logs, rebuilt. 0056 dropped it when the flat library_items
--    model was replaced; the table was collateral, not a decision (its FK
--    pointed at the discarded table). §17.9 needs it back, now keyed by event.
--
-- No data migration: existing rows keep NULL for every new column.

ALTER TABLE "library_items" ADD COLUMN IF NOT EXISTS "pdf_url" text;--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN IF NOT EXISTS "draft_pdf_url" text;--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN IF NOT EXISTS "draft_pdf_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN IF NOT EXISTS "draft_pdf_page_count" integer;--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN IF NOT EXISTS "draft_external_url" text;--> statement-breakpoint

-- Seed drafts from whatever is live so opening an item in the editor shows the
-- current state, not an empty field that would blank it on the next publish.
UPDATE "library_items"
   SET "draft_pdf_size_bytes" = "pdf_size_bytes"
 WHERE "draft_pdf_size_bytes" IS NULL AND "pdf_size_bytes" IS NOT NULL;--> statement-breakpoint

UPDATE "library_items"
   SET "draft_pdf_page_count" = "pdf_page_count"
 WHERE "draft_pdf_page_count" IS NULL AND "pdf_page_count" IS NOT NULL;--> statement-breakpoint

UPDATE "library_items"
   SET "draft_external_url" = "external_url"
 WHERE "draft_external_url" IS NULL AND "external_url" IS NOT NULL;--> statement-breakpoint

-- Modality CHECK gains pdf_url. Without this a PDF-only item cannot publish:
-- pdf_asset_id is never populated, so the 0073 clause can never be satisfied.
ALTER TABLE "library_items"
  DROP CONSTRAINT IF EXISTS "library_items_modality_check";--> statement-breakpoint

ALTER TABLE "library_items"
  ADD CONSTRAINT "library_items_modality_check" CHECK (
    NOT "is_published"
    OR "audio_url" IS NOT NULL
    OR "youtube_url" IS NOT NULL
    OR "text_content_en" IS NOT NULL
    OR "pdf_url" IS NOT NULL
    OR "pdf_asset_id" IS NOT NULL
    OR "external_url" IS NOT NULL
  ) NOT VALID;--> statement-breakpoint

ALTER TABLE "library_items" VALIDATE CONSTRAINT "library_items_modality_check";--> statement-breakpoint

-- §17.9 — access log, one row per (item, actor, event) with a count.
--
-- Distinct reach, not an append-only stream: that was the shipped v2 design
-- (0048 collapsed the append-forever table deliberately) and re-opening a
-- stotra thirty times is one reader, not thirty.
DO $$ BEGIN
  CREATE TYPE "library_access_event_enum" AS ENUM (
    'view', 'pdf_view', 'pdf_download', 'granth_view', 'external_link_open'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "library_access_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Nullable + SET NULL, as 0047 made it: losing an item must not erase the
  -- record that people read it.
  "library_item_id" uuid,
  "user_id" uuid,
  -- The same pre-login device identifier §17.9 uses for guests.
  "device_id" text,
  "event" "library_access_event_enum" DEFAULT 'view' NOT NULL,
  "access_count" integer DEFAULT 1 NOT NULL,
  "accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "library_access_logs_actor_check"
    CHECK ("user_id" IS NOT NULL OR "device_id" IS NOT NULL)
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "library_access_logs"
    ADD CONSTRAINT "library_access_logs_library_item_id_library_items_id_fk"
    FOREIGN KEY ("library_item_id") REFERENCES "public"."library_items"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "library_access_logs"
    ADD CONSTRAINT "library_access_logs_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_library_access_logs_item"
  ON "library_access_logs" USING btree ("library_item_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_library_access_logs_user"
  ON "library_access_logs" USING btree ("user_id");--> statement-breakpoint

-- Two partial uniques rather than one four-column unique: in a plain unique
-- index NULLs compare distinct, so a guest's every tap would insert a new row
-- and the count would never increment.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_library_access_logs_user_event"
  ON "library_access_logs" ("library_item_id", "event", "user_id")
  WHERE "user_id" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_library_access_logs_device_event"
  ON "library_access_logs" ("library_item_id", "event", "device_id")
  WHERE "user_id" IS NULL AND "device_id" IS NOT NULL;
