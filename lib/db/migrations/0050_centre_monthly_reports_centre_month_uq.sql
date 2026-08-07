-- Idempotent monthly report generation (cron + admin re-queue) needs one row
-- per (centre_id, month). Deduplicate keeping the newest row, then unique-index.
DELETE FROM centre_monthly_reports a
USING centre_monthly_reports b
WHERE a.centre_id = b.centre_id
  AND a.month = b.month
  AND (
    a.created_at < b.created_at
    OR (a.created_at = b.created_at AND a.id::text < b.id::text)
  );--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS centre_monthly_reports_centre_month_uq
  ON centre_monthly_reports (centre_id, month);--> statement-breakpoint
