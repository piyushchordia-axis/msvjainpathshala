-- FIX #10 — keyset pagination on (user_id, created_at DESC, id DESC).
CREATE INDEX IF NOT EXISTS idx_notifications_user_created_id
  ON notifications (user_id, created_at DESC, id DESC);--> statement-breakpoint
