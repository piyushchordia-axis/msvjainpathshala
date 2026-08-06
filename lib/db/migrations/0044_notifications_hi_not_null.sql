-- FIX #8 — require bilingual copy on notification rows.
-- Backfill FIRST so ALTER ... SET NOT NULL does not fail on legacy nulls.
UPDATE notifications
SET title_hi = COALESCE(title_hi, title_en)
WHERE title_hi IS NULL;--> statement-breakpoint

UPDATE notifications
SET body_hi = COALESCE(body_hi, body_en)
WHERE body_hi IS NULL;--> statement-breakpoint

ALTER TABLE notifications ALTER COLUMN title_hi SET NOT NULL;--> statement-breakpoint

ALTER TABLE notifications ALTER COLUMN body_hi SET NOT NULL;--> statement-breakpoint
