-- Section 17 v3 addendum, Part C — content requests, Tarj, Granth.
--
-- Three additions: a user-facing content-request queue (open to guests), an
-- optional Tarj caption on items, and the Granth directory (physical libraries
-- + granth entries, linked many-to-many).
--
-- No data migration: legacy library_items rows are untouched. All statements
-- are guarded so environments that gained any of this out-of-band are no-ops.

DO $$ BEGIN
  CREATE TYPE "library_content_request_status_enum"
    AS ENUM ('pending', 'accepted', 'rejected', 'published');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- library_items: PDF + external-link modalities, Tarj metadata.
-- pdf_asset_id is a bare uuid, not an FK: SPEC's media_assets table does not
-- exist in this monorepo yet (same holding pattern as
-- team_members.photo_override_asset_id).
ALTER TABLE "library_items" ADD COLUMN IF NOT EXISTS "tarj_en" text;--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN IF NOT EXISTS "tarj_hi" text;--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN IF NOT EXISTS "pdf_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN IF NOT EXISTS "pdf_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN IF NOT EXISTS "pdf_page_count" integer;--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN IF NOT EXISTS "external_url" text;--> statement-breakpoint

-- Modality constraint (v3 section 17.1.3), gated on is_published.
--
-- Two deliberate departures from the addendum's literal wording, both forced by
-- what this build actually is:
--
--   1. Column names. v3 names v2's columns (audio_asset_id, embed_url,
--      asset_id); this build has audio_url and youtube_url and no generic asset
--      column.
--   2. The is_published gate. POST /v1/admin/library/items inserts a title-only
--      draft and audio is attached by a separate later request, so the
--      unconditional form would reject every item creation. Gating on
--      is_published keeps the guarantee that matters — a reader never opens a
--      published item and finds nothing — and leaves the draft-first flow alone.
--
-- ADD CONSTRAINT ... CHECK never rewrites the table; NOT VALID additionally
-- skips the full scan under ACCESS EXCLUSIVE, and VALIDATE takes only
-- SHARE UPDATE EXCLUSIVE. Existing rows keep their data either way.
ALTER TABLE "library_items"
  DROP CONSTRAINT IF EXISTS "library_items_modality_check";--> statement-breakpoint
ALTER TABLE "library_items"
  ADD CONSTRAINT "library_items_modality_check" CHECK (
    NOT "is_published"
    OR "audio_url" IS NOT NULL
    OR "youtube_url" IS NOT NULL
    OR "text_content_en" IS NOT NULL
    OR "pdf_asset_id" IS NOT NULL
    OR "external_url" IS NOT NULL
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "library_items" VALIDATE CONSTRAINT "library_items_modality_check";--> statement-breakpoint

-- library_content_requests (v3 section 17.10).
-- No deleted_at: requests are never deleted. `rejected` and `published` are
-- terminal states retained for history and duplicate-spotting.
CREATE TABLE IF NOT EXISTS "library_content_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid,
	"suggested_section" text,
	"title" text NOT NULL,
	"details" text NOT NULL,
	"reference_url" text,
	"requester_user_id" uuid,
	"requester_device_id" text,
	"requester_name" text NOT NULL,
	"requester_phone" varchar(15) NOT NULL,
	"status" "library_content_request_status_enum" DEFAULT 'pending' NOT NULL,
	"admin_note" text,
	"linked_item_id" uuid,
	"actioned_by" uuid,
	"actioned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- section_id and requester_user_id are ON DELETE restrict, not set null: the
-- CHECKs below depend on them, so nulling either out would break a row that was
-- valid when written. Both parents are soft-deleted anyway.
DO $$ BEGIN
  ALTER TABLE "library_content_requests"
    ADD CONSTRAINT "library_content_requests_section_id_library_sections_id_fk"
    FOREIGN KEY ("section_id") REFERENCES "public"."library_sections"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_content_requests"
    ADD CONSTRAINT "library_content_requests_requester_user_id_users_id_fk"
    FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_content_requests"
    ADD CONSTRAINT "library_content_requests_linked_item_id_library_items_id_fk"
    FOREIGN KEY ("linked_item_id") REFERENCES "public"."library_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_content_requests"
    ADD CONSTRAINT "library_content_requests_actioned_by_users_id_fk"
    FOREIGN KEY ("actioned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- A request is anchored by an account OR the pre-login device id (section 17.9),
-- and targets a real section OR names one in free text — never neither.
DO $$ BEGIN
  ALTER TABLE "library_content_requests"
    ADD CONSTRAINT "library_content_requests_requester_check"
    CHECK ("requester_user_id" IS NOT NULL OR "requester_device_id" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_content_requests"
    ADD CONSTRAINT "library_content_requests_section_check"
    CHECK ("section_id" IS NOT NULL OR "suggested_section" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_library_content_requests_status_created"
  ON "library_content_requests" ("status", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_library_content_requests_user"
  ON "library_content_requests" ("requester_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_library_content_requests_device"
  ON "library_content_requests" ("requester_device_id");--> statement-breakpoint

-- granth_libraries (v3 section 17.11.3).
-- city_id is the same representation centres use — no new cities table.
CREATE TABLE IF NOT EXISTS "granth_libraries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_en" text NOT NULL,
	"name_hi" text,
	"address_en" text NOT NULL,
	"address_hi" text,
	"city_id" uuid NOT NULL,
	"contact_name" text,
	"contact_phone" varchar(15),
	"has_whatsapp" boolean DEFAULT false NOT NULL,
	"timings_en" text,
	"timings_hi" text,
	"lat" numeric(10, 7),
	"lng" numeric(10, 7),
	"note_en" text,
	"note_hi" text,
	"order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "granth_libraries"
    ADD CONSTRAINT "granth_libraries_city_id_cities_id_fk"
    FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_granth_libraries_city"
  ON "granth_libraries" ("city_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_granth_libraries_published_order"
  ON "granth_libraries" ("is_published", "order") WHERE "deleted_at" IS NULL;--> statement-breakpoint

-- granth_entries (v3 section 17.11.3).
-- `language` is free text: granths run to Prakrit, Sanskrit and Gujarati, which
-- language_enum (en|hi) cannot express.
CREATE TABLE IF NOT EXISTS "granth_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title_en" text NOT NULL,
	"title_hi" text,
	"author_en" text,
	"author_hi" text,
	"language" text,
	"description_en" text,
	"description_hi" text,
	"linked_item_id" uuid,
	"order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "granth_entries"
    ADD CONSTRAINT "granth_entries_linked_item_id_library_items_id_fk"
    FOREIGN KEY ("linked_item_id") REFERENCES "public"."library_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_granth_entries_linked_item"
  ON "granth_entries" ("linked_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_granth_entries_published_order"
  ON "granth_entries" ("is_published", "order") WHERE "deleted_at" IS NULL;--> statement-breakpoint

-- granth_availability (v3 section 17.11.3).
-- M2M join, browsable both ways. created_at only — there is nothing to update.
CREATE TABLE IF NOT EXISTS "granth_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"granth_id" uuid NOT NULL,
	"library_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "granth_availability"
    ADD CONSTRAINT "granth_availability_granth_id_granth_entries_id_fk"
    FOREIGN KEY ("granth_id") REFERENCES "public"."granth_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "granth_availability"
    ADD CONSTRAINT "granth_availability_library_id_granth_libraries_id_fk"
    FOREIGN KEY ("library_id") REFERENCES "public"."granth_libraries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_granth_availability_granth_library"
  ON "granth_availability" ("granth_id", "library_id");--> statement-breakpoint
-- Browse-by-library needs the non-leading column of the unique index above.
CREATE INDEX IF NOT EXISTS "idx_granth_availability_library"
  ON "granth_availability" ("library_id");
