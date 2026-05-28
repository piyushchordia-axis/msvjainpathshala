-- Step 6 — Geography / Centres / Batches / Form-configs surface
--
-- Two small schema deltas:
--   1. centres.gps_radius_m default 150 → 500 (per Step 6 prompt). Existing
--      rows are left at 150 — only newly inserted centres pick up the new
--      default. Service-layer validation enforces a sensible range.
--   2. batches.language_preference text (nullable) so the create-batch DTO
--      can carry the language hint specified in the Step 6 prompt.

ALTER TABLE "centres" ALTER COLUMN "gps_radius_m" SET DEFAULT 500;--> statement-breakpoint

ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "language_preference" text;
