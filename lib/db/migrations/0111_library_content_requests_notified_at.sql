-- X-17 (Notifications & Notices review, 2026-08) — publishLinkedContentRequests
-- flipped every matching row to 'published' (terminal) in one UPDATE, then
-- looped notifying. If the loop threw partway through, the already-terminal
-- rows could never be found again (the retry WHERE requires status =
-- 'accepted') and stayed unnotified forever. This per-row marker lets a
-- retry target rows that are published but never got their notification.
ALTER TABLE library_content_requests ADD COLUMN IF NOT EXISTS notified_at timestamptz;--> statement-breakpoint
