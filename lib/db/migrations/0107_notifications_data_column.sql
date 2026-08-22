-- DB-1 / X-9 (Notifications & Notices review, 2026-08) — notifications had
-- no data/entity column at all, so the durable inbox row could never
-- deep-link even in principle; opts.data was merged into the push payload
-- only and lost the moment the push send finished. notifyUsers already
-- accepts opts.data — this column is what lets it persist it.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data jsonb;--> statement-breakpoint
