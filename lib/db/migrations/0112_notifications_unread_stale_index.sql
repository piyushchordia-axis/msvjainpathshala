-- X-21 (Notifications & Notices review, 2026-08) — retention.ts's comment
-- "unread rows are never pruned" was true with no ceiling at all: an
-- inactive user's inbox grew without bound. Adding a long-horizon cap for
-- stale unread rows (lib/retention.ts) needs an access path for the
-- opposite predicate from the existing read-row partial index (0108).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_unread_stale
  ON notifications (created_at)
  WHERE read_at IS NULL;--> statement-breakpoint
