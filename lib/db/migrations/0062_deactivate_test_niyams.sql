-- Soft-deactivate leftover API-test niyams (title_en like "Test Niyam …").
-- Keeps submissions / streaks FKs; catalog already filters is_active = true.

UPDATE "niyams"
SET
  "is_active" = false,
  "updated_at" = now()
WHERE "title_en" ILIKE 'Test Niyam%';
