-- Notifications & Notices review, 2026-08:
--   DB-5 — idx_notifications_user_created (user_id, created_at) is a strict
--     prefix of idx_notifications_user_created_id (0046), which also breaks
--     ties on id for keyset pagination. The insert-hottest table in the app
--     was maintaining three B-trees where two suffice.
--   DB-2 — retention.ts's prune query filters read_at IS NOT NULL and sorts
--     by created_at with no index leading on either column, so every 5000-row
--     batch was a full seq scan plus a top-N sort.
--
-- CONCURRENTLY cannot run inside a transaction; lib/db/scripts/migrate.mjs
-- detects it and applies this file statement-by-statement in autocommit.

DROP INDEX CONCURRENTLY IF EXISTS idx_notifications_user_created;--> statement-breakpoint

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_retention_prune
  ON notifications (created_at)
  WHERE read_at IS NOT NULL;--> statement-breakpoint
