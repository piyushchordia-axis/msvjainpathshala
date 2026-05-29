-- Step 21 — AI Service & Donations
--
-- Deltas:
--   1. `donations` — three new columns:
--        - donor_user_id            FK → users.id (when donor is signed in)
--        - receipt_asset_id         FK → media_assets.id (PDF receipt)
--        - financial_year           text (e.g. '2025-26') — populated on capture
--      We keep the existing `donor_pan` column for the encrypted-PAN ciphertext
--      and `eighty_g_certificate_asset_id` for the 80G PDF.
--   2. `donation_webhook_events` — append-only ledger so duplicate webhook
--      deliveries are no-ops (SPEC §8.8). PK on event_id; INSERT ON CONFLICT
--      DO NOTHING.
--   3. `platform_settings` — seed the singleton row so admin PATCH always
--      finds it. Idempotent.
--   4. `ai_generation_jobs.status` already exists from 0015; no schema change
--      needed. We re-emphasise the index for status='ready' lookups.
--   5. Indexes:
--        - donations(donor_user_id, payment_captured_at desc) — donor history
--        - donations(financial_year) — 80G yearly summaries
--        - donation_campaigns(is_public, ends_at) — public campaign listings
--
-- All blocks are idempotent.

-- ===== 1. donations — new columns ==========================================
ALTER TABLE "donations"
  ADD COLUMN IF NOT EXISTS "donor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE "donations"
  ADD COLUMN IF NOT EXISTS "receipt_asset_id" uuid REFERENCES "media_assets"("id") ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE "donations"
  ADD COLUMN IF NOT EXISTS "financial_year" text;
--> statement-breakpoint

-- ===== 2. donation_webhook_events =========================================
CREATE TABLE IF NOT EXISTS "donation_webhook_events" (
  "event_id" text PRIMARY KEY,
  "event_type" text NOT NULL,
  "razorpay_payment_id" text,
  "razorpay_order_id" text,
  "donation_id" uuid REFERENCES "donations"("id") ON DELETE SET NULL,
  "payload" jsonb NOT NULL,
  "received_at" timestamp with time zone NOT NULL DEFAULT now(),
  "processed_at" timestamp with time zone
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_donation_webhook_events_received"
  ON "donation_webhook_events" ("received_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_donation_webhook_events_payment"
  ON "donation_webhook_events" ("razorpay_payment_id")
  WHERE "razorpay_payment_id" IS NOT NULL;
--> statement-breakpoint

-- ===== 3. platform_settings — seed singleton ==============================
INSERT INTO "platform_settings"
  ("id", "eighty_g_enabled", "eighty_g_section", "created_at", "updated_at")
VALUES
  ('global', false, '80G', now(), now())
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

-- ===== 4. ai_generation_jobs — status lookup index ========================
CREATE INDEX IF NOT EXISTS "idx_ai_gen_jobs_status"
  ON "ai_generation_jobs" ("status", "created_at" DESC);
--> statement-breakpoint

-- ===== 5. donations / campaigns — listing indexes ==========================
CREATE INDEX IF NOT EXISTS "idx_donations_donor_user"
  ON "donations" ("donor_user_id", "payment_captured_at" DESC)
  WHERE "donor_user_id" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_donations_financial_year"
  ON "donations" ("financial_year")
  WHERE "financial_year" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_donation_campaigns_public_ends"
  ON "donation_campaigns" ("is_public", "ends_at" DESC)
  WHERE "deleted_at" IS NULL;
