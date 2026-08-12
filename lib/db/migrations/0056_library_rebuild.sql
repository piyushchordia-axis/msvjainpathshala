-- Library rebuild: discard flat library_items + access logs; Section → SubSection → Item.

DROP TABLE IF EXISTS "library_access_logs";--> statement-breakpoint
DROP TABLE IF EXISTS "library_items";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."library_content_type_enum";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."library_access_tier_enum";--> statement-breakpoint

CREATE TYPE "public"."library_section_type_enum" AS ENUM('item_list', 'deeplink', 'panchang');--> statement-breakpoint

CREATE TABLE "library_sections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "name_en" text NOT NULL,
  "name_hi" text,
  "name_gu" text,
  "icon_url" text,
  "order_index" integer DEFAULT 0 NOT NULL,
  "type" "library_section_type_enum" NOT NULL,
  "deeplink_target" text,
  "requires_login" boolean DEFAULT false NOT NULL,
  "is_published" boolean DEFAULT false NOT NULL,
  "content_version" integer DEFAULT 1 NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX "idx_library_sections_key" ON "library_sections" ("key");--> statement-breakpoint
CREATE INDEX "idx_library_sections_type" ON "library_sections" ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_library_sections_order" ON "library_sections" ("order_index") WHERE "deleted_at" IS NULL;--> statement-breakpoint

CREATE TABLE "library_subsections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "section_id" uuid NOT NULL,
  "name_en" text NOT NULL,
  "name_hi" text,
  "name_gu" text,
  "order_index" integer DEFAULT 0 NOT NULL,
  "is_published" boolean DEFAULT false NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "library_subsections"
  ADD CONSTRAINT "library_subsections_section_id_library_sections_id_fk"
  FOREIGN KEY ("section_id") REFERENCES "public"."library_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "idx_library_subsections_section" ON "library_subsections" ("section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_library_subsections_order" ON "library_subsections" ("section_id", "order_index") WHERE "deleted_at" IS NULL;--> statement-breakpoint

CREATE TABLE "library_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "section_id" uuid NOT NULL,
  "subsection_id" uuid,
  "item_code" text NOT NULL,
  "title_en" text NOT NULL,
  "title_hi" text,
  "title_gu" text,
  "order_index" integer DEFAULT 0 NOT NULL,
  "audio_url" text,
  "audio_size_bytes" bigint,
  "audio_duration_sec" integer,
  "youtube_url" text,
  "text_content_en" text,
  "text_content_hi" text,
  "text_content_gu" text,
  "content_version" integer DEFAULT 1 NOT NULL,
  "is_published" boolean DEFAULT false NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "library_items"
  ADD CONSTRAINT "library_items_section_id_library_sections_id_fk"
  FOREIGN KEY ("section_id") REFERENCES "public"."library_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "library_items"
  ADD CONSTRAINT "library_items_subsection_id_library_subsections_id_fk"
  FOREIGN KEY ("subsection_id") REFERENCES "public"."library_subsections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "idx_library_items_item_code" ON "library_items" ("item_code");--> statement-breakpoint
CREATE INDEX "idx_library_items_section" ON "library_items" ("section_id");--> statement-breakpoint
CREATE INDEX "idx_library_items_subsection" ON "library_items" ("subsection_id");--> statement-breakpoint
