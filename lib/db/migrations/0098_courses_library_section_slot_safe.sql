-- H29 — 0058 hardcoded order_index = 3 / draft_order_index = 3 for the
-- Courses library-section deeplink row, guarded only on
-- `WHERE NOT EXISTS (... key = 'courses')`. Both columns carry a partial
-- UNIQUE index scoped to live rows (idx_library_sections_order,
-- idx_library_sections_draft_order — see lib/db/src/schema/library.ts). On any
-- deploy where slot 3 is already occupied by another live section (for
-- example after an admin re-ordered the catalogue), that insert 23505s and
-- migrate.mjs rolls the whole file back and halts the chain.
--
-- 0058 itself is migration-history-frozen (never edit an already-merged
-- migration file — see CLAUDE.md's migration-safety note) and cannot be
-- patched in place. This migration re-expresses the SAME row insert the
-- deploy-safe way: the slot is derived (MAX(order_index) + 1 / MAX(
-- draft_order_index) + 1 over live rows) instead of hardcoded, with
-- ON CONFLICT DO NOTHING on the section's unique key as a second guard.
--
-- On every environment where 0058 already succeeded (the 'courses' row
-- already exists — true for every chain that has reached this migration
-- normally), this is a pure no-op. It exists as the correct, safe insert an
-- operator can fall back to by hand if 0058 ever aborts on a slot collision
-- on a database that has not reached 0058 yet — a later migration cannot
-- make an EARLIER, already-queued file retry differently, so this does not by
-- itself un-stick a chain that is stuck failing at 0058; it gives whoever is
-- unsticking it the corrected logic instead of the hardcoded one.

INSERT INTO "library_sections" (
  "key",
  "name_en",
  "name_hi",
  "name_gu",
  "order_index",
  "type",
  "deeplink_target",
  "requires_login",
  "draft_name_en",
  "draft_name_hi",
  "draft_name_gu",
  "draft_type",
  "draft_deeplink_target",
  "draft_requires_login",
  "draft_order_index",
  "is_published",
  "content_version"
)
SELECT
  'courses',
  'Courses',
  'पाठ्यक्रम',
  'અભ્યાસક્રમ',
  (SELECT COALESCE(MAX("order_index"), -1) + 1 FROM "library_sections" WHERE "deleted_at" IS NULL),
  'deeplink',
  '/courses',
  true,
  'Courses',
  'पाठ्यक्रम',
  'અભ્યાસક્રમ',
  'deeplink',
  '/courses',
  true,
  (SELECT COALESCE(MAX("draft_order_index"), -1) + 1 FROM "library_sections" WHERE "deleted_at" IS NULL),
  true,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM "library_sections" WHERE "key" = 'courses'
)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
