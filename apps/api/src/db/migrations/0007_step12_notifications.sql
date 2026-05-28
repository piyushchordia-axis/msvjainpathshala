-- Step 12 — Notifications & Realtime
--
-- Two schema deltas needed by the notifications module:
--   1. users.notification_preferences jsonb — per-user channel toggles
--      (push/sms/email/in_app). CLAUDE.md "common pitfalls" calls out the
--      contract: `users.notification_preferences.sms` must be checked
--      before any SMS job is enqueued. Default is every channel on.
--   2. device_tokens.device_id text — optional client-supplied device id
--      so logout can invalidate the matching push token without the
--      mobile app having to track its own row id.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "notification_preferences" jsonb
  NOT NULL
  DEFAULT '{"push": true, "sms": true, "email": true, "in_app": true}'::jsonb;
--> statement-breakpoint

ALTER TABLE "device_tokens"
  ADD COLUMN IF NOT EXISTS "device_id" text;
