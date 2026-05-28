-- Step 14 — Offline Sync Engine
--
-- Two deltas:
--   1. Relax `client_op_id` from uuid → text on `sync_operations` and
--      `attendance`. The mobile clients generate ULIDs (Crockford base32,
--      26 chars) via `ulid()` for stable sort order in MMKV queues, which
--      a `uuid` column rejects. The columns remain UNIQUE-indexed.
--   2. Add the `processing` value to `sync_op_status_enum` so the batch
--      handler can mark a row "in flight" before dispatching the op — this
--      lets a racing replay from a second device see the prior request and
--      short-circuit rather than re-dispatch (SPEC §11.4 conflict policy).

-- ===== 1. client_op_id text widening =======================================
-- attendance.client_op_id is nullable; cast is straightforward.
ALTER TABLE "attendance" ALTER COLUMN "client_op_id" TYPE text USING "client_op_id"::text;
--> statement-breakpoint

-- sync_operations.client_op_id is NOT NULL; same in-place cast works because
-- text accepts every uuid value.
ALTER TABLE "sync_operations" ALTER COLUMN "client_op_id" TYPE text USING "client_op_id"::text;
--> statement-breakpoint

-- ===== 2. Extend sync_op_status_enum with 'processing' =====================
-- IF NOT EXISTS keeps the migration idempotent on re-runs.
ALTER TYPE "sync_op_status_enum" ADD VALUE IF NOT EXISTS 'processing';
