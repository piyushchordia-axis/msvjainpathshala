-- Section 17 v3 §17.9 — access logs can target a SECTION, not only an item.
--
-- 0077 rebuilt library_access_logs keyed to library_item_id, which covers every
-- event that fires on a piece of content: pdf_view, pdf_download,
-- external_link_open. `granth_view` is different — §17.9 defines it as "granth
-- section open", and a section id is not an item id. Reported against the item
-- column it matches no published item and is silently dropped; spread across
-- every item in the section it would multiply one open into fifty reads.
--
-- So the row gains a second, mutually exclusive target. No CHECK requiring one
-- of them: both FKs are ON DELETE SET NULL, and a check would turn deleting a
-- logged item into a constraint violation rather than a tidy-up.

ALTER TABLE "library_access_logs"
  ADD COLUMN IF NOT EXISTS "library_section_id" uuid;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "library_access_logs"
    ADD CONSTRAINT "library_access_logs_library_section_id_library_sections_id_fk"
    FOREIGN KEY ("library_section_id") REFERENCES "public"."library_sections"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_library_access_logs_section"
  ON "library_access_logs" USING btree ("library_section_id");--> statement-breakpoint

-- Distinct reach is now per (target, actor, event), and the target may be
-- either column — so four partial uniques rather than two. The item indexes
-- gain an explicit "item is the target" predicate: without it a section-target
-- row (library_item_id NULL) would collide with every other section row for the
-- same actor and event, because NULL = NULL is not what a unique index tests.
DROP INDEX IF EXISTS "idx_library_access_logs_user_event";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_library_access_logs_device_event";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_library_access_logs_item_user_event"
  ON "library_access_logs" ("library_item_id", "event", "user_id")
  WHERE "library_item_id" IS NOT NULL AND "user_id" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_library_access_logs_item_device_event"
  ON "library_access_logs" ("library_item_id", "event", "device_id")
  WHERE "library_item_id" IS NOT NULL AND "user_id" IS NULL AND "device_id" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_library_access_logs_section_user_event"
  ON "library_access_logs" ("library_section_id", "event", "user_id")
  WHERE "library_section_id" IS NOT NULL AND "user_id" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_library_access_logs_section_device_event"
  ON "library_access_logs" ("library_section_id", "event", "device_id")
  WHERE "library_section_id" IS NOT NULL AND "user_id" IS NULL AND "device_id" IS NOT NULL;
