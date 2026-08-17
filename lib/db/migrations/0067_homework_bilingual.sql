-- Bilingual homework (PAR-DSN-15). All user-facing content carries _en/_hi per
-- CLAUDE.md; homework title/description were the last single-language strings a
-- parent reads, so a Hindi-preference family saw Devanagari card chrome wrapped
-- around an English title.
--
-- Nullable and additive on purpose: `title`/`description` stay the EN source of
-- truth, existing rows keep working, and clients fall back to them when the
-- Hindi column is null rather than rendering blank. No backfill — machine
-- translating a Guruji's instructions unreviewed would be worse than showing
-- the original.
ALTER TABLE "homework_assignments" ADD COLUMN IF NOT EXISTS "title_hi" text;
ALTER TABLE "homework_assignments" ADD COLUMN IF NOT EXISTS "description_hi" text;
