-- DB-7 (Notifications & Notices review, 2026-08) — notices.title_hi was
-- nullable while notifications.title_hi is NOT NULL, so mobile refused to
-- submit a notice without a Hindi title while web treated it as optional.
-- Backfill first so ALTER ... SET NOT NULL does not fail on legacy nulls,
-- same pattern as 0044_notifications_hi_not_null.sql.
UPDATE notices
SET title_hi = COALESCE(title_hi, title_en)
WHERE title_hi IS NULL;--> statement-breakpoint

ALTER TABLE notices ALTER COLUMN title_hi SET NOT NULL;--> statement-breakpoint
