-- Step 4 — seed the three pieces of static data the platform needs to boot:
--   1. platform_settings singleton (id='global', eighty_g_enabled=false)
--   2. punya_features catalogue (8 inferred-default rows; per-city overrides
--      live in punya_configs at runtime)
--   3. registration_form_configs — five default personas (city_id NULL =
--      global; cities override per-row)
--
-- Each block is `ON CONFLICT DO NOTHING` so re-running the migration after
-- a manual edit is safe.

-- ===== 1. platform_settings singleton ========================================
INSERT INTO "platform_settings" ("id", "eighty_g_enabled", "eighty_g_section",
                                 "created_at", "updated_at")
VALUES ('global', false, '80G', now(), now())
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

-- ===== 2. punya_features catalogue ==========================================
-- Values inferred from SPEC §5.7 + the patterns called out in CLAUDE.md and
-- the BRD excerpt visible in the spec. The exact numbers are per-city
-- configurable via `punya_configs.points_override`.
INSERT INTO "punya_features"
  ("key", "default_points", "is_manual", "requires_reason", "scope",
   "created_at", "updated_at")
VALUES
  ('attendance_present',      10, false, false, 'global', now(), now()),
  ('homework_approved',       15, false, false, 'global', now(), now()),
  ('niyam_completion',         0, false, false, 'global', now(), now()),
  ('manual_seva',              0, true,  true,  'global', now(), now()),
  ('streak_bonus_7day',       20, false, false, 'global', now(), now()),
  ('streak_bonus_30day',      50, false, false, 'global', now(), now()),
  ('competition_winner',      50, false, false, 'global', now(), now()),
  ('competition_participant', 10, false, false, 'global', now(), now())
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- ===== 3. registration_form_configs — five default personas =================
-- city_id IS NULL means "global default"; cities override by inserting a row
-- with their own city_id (the unique index treats NULLs as distinct per
-- Postgres semantics).
INSERT INTO "registration_form_configs"
  ("city_id", "form_kind", "version_no", "is_active",
   "base_field_overrides", "custom_fields", "created_at", "updated_at")
VALUES
  (NULL, 'student',    1, true, '{}'::jsonb, '[]'::jsonb, now(), now()),
  (NULL, 'parent',     1, true, '{}'::jsonb, '[]'::jsonb, now(), now()),
  (NULL, 'shikshak',   1, true, '{}'::jsonb, '[]'::jsonb, now(), now()),
  (NULL, 'sanchalak',  1, true, '{}'::jsonb, '[]'::jsonb, now(), now()),
  (NULL, 'city_admin', 1, true, '{}'::jsonb, '[]'::jsonb, now(), now())
ON CONFLICT DO NOTHING;
