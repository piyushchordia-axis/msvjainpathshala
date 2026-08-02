-- AT30 — public holidays are published-only.
ALTER TABLE "centre_holidays" ADD COLUMN IF NOT EXISTS "is_published" boolean DEFAULT true NOT NULL;
