-- Section 17 v3 §17.11.5 — draft/publish for the Granth directory.
--
-- 0073 created granth_libraries and granth_entries with is_published and
-- content_version but no draft_* twins, so the only way to edit one was to
-- write straight to the live row. §17.11.5 says these follow "existing library
-- rules": edits land in a draft, publishing copies it across and increments
-- content_version. Without the twins an admin correcting a phone number would
-- change what readers see mid-edit, and content_version would never move — so
-- no device holding the cached directory would ever learn about it.
--
-- Every draft column is backfilled from its live value so an existing row opens
-- in the editor showing what is currently published, rather than blank fields
-- that would erase the row on the next publish.

/* ── granth_libraries ─────────────────────────────────────────────────────── */

ALTER TABLE "granth_libraries" ADD COLUMN IF NOT EXISTS "draft_name_en" text;--> statement-breakpoint
ALTER TABLE "granth_libraries" ADD COLUMN IF NOT EXISTS "draft_name_hi" text;--> statement-breakpoint
ALTER TABLE "granth_libraries" ADD COLUMN IF NOT EXISTS "draft_address_en" text;--> statement-breakpoint
ALTER TABLE "granth_libraries" ADD COLUMN IF NOT EXISTS "draft_address_hi" text;--> statement-breakpoint
ALTER TABLE "granth_libraries" ADD COLUMN IF NOT EXISTS "draft_city_id" uuid;--> statement-breakpoint
ALTER TABLE "granth_libraries" ADD COLUMN IF NOT EXISTS "draft_contact_name" text;--> statement-breakpoint
ALTER TABLE "granth_libraries" ADD COLUMN IF NOT EXISTS "draft_contact_phone" varchar(15);--> statement-breakpoint
ALTER TABLE "granth_libraries" ADD COLUMN IF NOT EXISTS "draft_has_whatsapp" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "granth_libraries" ADD COLUMN IF NOT EXISTS "draft_timings_en" text;--> statement-breakpoint
ALTER TABLE "granth_libraries" ADD COLUMN IF NOT EXISTS "draft_timings_hi" text;--> statement-breakpoint
ALTER TABLE "granth_libraries" ADD COLUMN IF NOT EXISTS "draft_lat" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "granth_libraries" ADD COLUMN IF NOT EXISTS "draft_lng" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "granth_libraries" ADD COLUMN IF NOT EXISTS "draft_note_en" text;--> statement-breakpoint
ALTER TABLE "granth_libraries" ADD COLUMN IF NOT EXISTS "draft_note_hi" text;--> statement-breakpoint
ALTER TABLE "granth_libraries" ADD COLUMN IF NOT EXISTS "draft_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

UPDATE "granth_libraries"
   SET "draft_name_en" = COALESCE("draft_name_en", "name_en"),
       "draft_name_hi" = COALESCE("draft_name_hi", "name_hi"),
       "draft_address_en" = COALESCE("draft_address_en", "address_en"),
       "draft_address_hi" = COALESCE("draft_address_hi", "address_hi"),
       "draft_city_id" = COALESCE("draft_city_id", "city_id"),
       "draft_contact_name" = COALESCE("draft_contact_name", "contact_name"),
       "draft_contact_phone" = COALESCE("draft_contact_phone", "contact_phone"),
       "draft_has_whatsapp" = "has_whatsapp",
       "draft_timings_en" = COALESCE("draft_timings_en", "timings_en"),
       "draft_timings_hi" = COALESCE("draft_timings_hi", "timings_hi"),
       "draft_lat" = COALESCE("draft_lat", "lat"),
       "draft_lng" = COALESCE("draft_lng", "lng"),
       "draft_note_en" = COALESCE("draft_note_en", "note_en"),
       "draft_note_hi" = COALESCE("draft_note_hi", "note_hi"),
       "draft_order" = "order";--> statement-breakpoint

-- NOT NULL only after the backfill; these three have no sensible default.
ALTER TABLE "granth_libraries" ALTER COLUMN "draft_name_en" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "granth_libraries" ALTER COLUMN "draft_address_en" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "granth_libraries" ALTER COLUMN "draft_city_id" SET NOT NULL;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "granth_libraries"
    ADD CONSTRAINT "granth_libraries_draft_city_id_cities_id_fk"
    FOREIGN KEY ("draft_city_id") REFERENCES "public"."cities"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- The draft city is a scoping key, not just a field: a city_admin's list is
-- built from it, so it needs the same index the live column has.
CREATE INDEX IF NOT EXISTS "idx_granth_libraries_draft_city"
  ON "granth_libraries" USING btree ("draft_city_id");--> statement-breakpoint

/* ── granth_entries ───────────────────────────────────────────────────────── */

ALTER TABLE "granth_entries" ADD COLUMN IF NOT EXISTS "draft_title_en" text;--> statement-breakpoint
ALTER TABLE "granth_entries" ADD COLUMN IF NOT EXISTS "draft_title_hi" text;--> statement-breakpoint
ALTER TABLE "granth_entries" ADD COLUMN IF NOT EXISTS "draft_author_en" text;--> statement-breakpoint
ALTER TABLE "granth_entries" ADD COLUMN IF NOT EXISTS "draft_author_hi" text;--> statement-breakpoint
ALTER TABLE "granth_entries" ADD COLUMN IF NOT EXISTS "draft_language" text;--> statement-breakpoint
ALTER TABLE "granth_entries" ADD COLUMN IF NOT EXISTS "draft_description_en" text;--> statement-breakpoint
ALTER TABLE "granth_entries" ADD COLUMN IF NOT EXISTS "draft_description_hi" text;--> statement-breakpoint
ALTER TABLE "granth_entries" ADD COLUMN IF NOT EXISTS "draft_linked_item_id" uuid;--> statement-breakpoint
ALTER TABLE "granth_entries" ADD COLUMN IF NOT EXISTS "draft_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

UPDATE "granth_entries"
   SET "draft_title_en" = COALESCE("draft_title_en", "title_en"),
       "draft_title_hi" = COALESCE("draft_title_hi", "title_hi"),
       "draft_author_en" = COALESCE("draft_author_en", "author_en"),
       "draft_author_hi" = COALESCE("draft_author_hi", "author_hi"),
       "draft_language" = COALESCE("draft_language", "language"),
       "draft_description_en" = COALESCE("draft_description_en", "description_en"),
       "draft_description_hi" = COALESCE("draft_description_hi", "description_hi"),
       "draft_linked_item_id" = COALESCE("draft_linked_item_id", "linked_item_id"),
       "draft_order" = "order";--> statement-breakpoint

ALTER TABLE "granth_entries" ALTER COLUMN "draft_title_en" SET NOT NULL;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "granth_entries"
    ADD CONSTRAINT "granth_entries_draft_linked_item_id_library_items_id_fk"
    FOREIGN KEY ("draft_linked_item_id") REFERENCES "public"."library_items"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
