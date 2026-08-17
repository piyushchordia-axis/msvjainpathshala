-- Repair: niyam_submission_media exists in schema.ts (and snapshot 0009) but
-- no migration ever created it — a fresh database 500s on every multi-proof
-- niyam submission (NEW-3 offline media path). All statements are guarded so
-- environments that gained the table out-of-band are untouched.

DO $$ BEGIN
  CREATE TYPE "niyam_media_kind_enum" AS ENUM ('photo', 'video', 'audio');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "niyam_submission_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"url" text NOT NULL,
	"kind" "niyam_media_kind_enum" NOT NULL,
	"mime" text,
	"size_bytes" integer,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "niyam_submission_media"
    ADD CONSTRAINT "niyam_submission_media_submission_id_niyam_submissions_id_fk"
    FOREIGN KEY ("submission_id") REFERENCES "public"."niyam_submissions"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_niyam_submission_media_submission" ON "niyam_submission_media" ("submission_id");
