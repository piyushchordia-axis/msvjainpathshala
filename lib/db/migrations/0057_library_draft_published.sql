-- 0057_library_draft_published.sql
-- Parallel draft_* columns (edits) vs existing published columns (public API).
-- Publish copies draft → published and bumps content_version.

-- ── Sections draft mirrors ──────────────────────────────────────────────────
ALTER TABLE library_sections
  ADD COLUMN IF NOT EXISTS draft_name_en text,
  ADD COLUMN IF NOT EXISTS draft_name_hi text,
  ADD COLUMN IF NOT EXISTS draft_name_gu text,
  ADD COLUMN IF NOT EXISTS draft_icon_url text,
  ADD COLUMN IF NOT EXISTS draft_type library_section_type_enum,
  ADD COLUMN IF NOT EXISTS draft_deeplink_target text,
  ADD COLUMN IF NOT EXISTS draft_requires_login boolean,
  ADD COLUMN IF NOT EXISTS draft_order_index integer;

UPDATE library_sections SET
  draft_name_en = name_en,
  draft_name_hi = name_hi,
  draft_name_gu = name_gu,
  draft_icon_url = icon_url,
  draft_type = type,
  draft_deeplink_target = deeplink_target,
  draft_requires_login = requires_login,
  draft_order_index = order_index
WHERE draft_name_en IS NULL;

ALTER TABLE library_sections
  ALTER COLUMN draft_name_en SET NOT NULL,
  ALTER COLUMN draft_type SET NOT NULL,
  ALTER COLUMN draft_requires_login SET NOT NULL,
  ALTER COLUMN draft_requires_login SET DEFAULT false,
  ALTER COLUMN draft_order_index SET NOT NULL,
  ALTER COLUMN draft_order_index SET DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_library_sections_draft_order
  ON library_sections (draft_order_index)
  WHERE deleted_at IS NULL;

-- ── Subsections draft mirrors + content_version ─────────────────────────────
ALTER TABLE library_subsections
  ADD COLUMN IF NOT EXISTS draft_name_en text,
  ADD COLUMN IF NOT EXISTS draft_name_hi text,
  ADD COLUMN IF NOT EXISTS draft_name_gu text,
  ADD COLUMN IF NOT EXISTS draft_order_index integer,
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 1;

UPDATE library_subsections SET
  draft_name_en = name_en,
  draft_name_hi = name_hi,
  draft_name_gu = name_gu,
  draft_order_index = order_index
WHERE draft_name_en IS NULL;

ALTER TABLE library_subsections
  ALTER COLUMN draft_name_en SET NOT NULL,
  ALTER COLUMN draft_order_index SET NOT NULL,
  ALTER COLUMN draft_order_index SET DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_library_subsections_draft_order
  ON library_subsections (section_id, draft_order_index)
  WHERE deleted_at IS NULL;

-- ── Items draft mirrors ─────────────────────────────────────────────────────
ALTER TABLE library_items
  ADD COLUMN IF NOT EXISTS draft_title_en text,
  ADD COLUMN IF NOT EXISTS draft_title_hi text,
  ADD COLUMN IF NOT EXISTS draft_title_gu text,
  ADD COLUMN IF NOT EXISTS draft_order_index integer,
  ADD COLUMN IF NOT EXISTS draft_audio_url text,
  ADD COLUMN IF NOT EXISTS draft_audio_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS draft_audio_duration_sec integer,
  ADD COLUMN IF NOT EXISTS draft_youtube_url text,
  ADD COLUMN IF NOT EXISTS draft_text_content_en text,
  ADD COLUMN IF NOT EXISTS draft_text_content_hi text,
  ADD COLUMN IF NOT EXISTS draft_text_content_gu text;

UPDATE library_items SET
  draft_title_en = title_en,
  draft_title_hi = title_hi,
  draft_title_gu = title_gu,
  draft_order_index = order_index,
  draft_audio_url = audio_url,
  draft_audio_size_bytes = audio_size_bytes,
  draft_audio_duration_sec = audio_duration_sec,
  draft_youtube_url = youtube_url,
  draft_text_content_en = text_content_en,
  draft_text_content_hi = text_content_hi,
  draft_text_content_gu = text_content_gu
WHERE draft_title_en IS NULL;

ALTER TABLE library_items
  ALTER COLUMN draft_title_en SET NOT NULL,
  ALTER COLUMN draft_order_index SET NOT NULL,
  ALTER COLUMN draft_order_index SET DEFAULT 0;

-- ── Panchang year drafts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS panchang_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL,
  sect text NOT NULL,
  vikram_samvat integer NOT NULL,
  veer_samvat integer NOT NULL,
  draft_payload jsonb NOT NULL,
  published_payload jsonb,
  is_published boolean NOT NULL DEFAULT false,
  content_version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_panchang_years_year UNIQUE (year)
);

CREATE INDEX IF NOT EXISTS idx_panchang_years_published
  ON panchang_years (is_published)
  WHERE deleted_at IS NULL;
