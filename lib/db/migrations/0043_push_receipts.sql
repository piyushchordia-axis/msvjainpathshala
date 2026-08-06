-- Expo push receipt ledger for async DeviceNotRegistered reaping (FIX #3).
CREATE TABLE IF NOT EXISTS push_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id text NOT NULL,
  expo_token text NOT NULL,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS push_receipts_ticket_id_unique
  ON push_receipts (ticket_id);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_push_receipts_unchecked
  ON push_receipts (checked_at, created_at);--> statement-breakpoint
