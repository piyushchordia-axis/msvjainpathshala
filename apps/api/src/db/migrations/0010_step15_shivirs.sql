-- Step 15 — QR Scanning & Shivir Management
--
-- Two related deltas:
--   1. Widen shivir_attendance_scans.client_op_id from uuid → text. Mobile
--      generates ULIDs (Crockford base32, 26 chars) for offline-queue keys,
--      matching the Step-14 widening of attendance + sync_operations.
--      The unique index is preserved as-is (text columns index fine).
--   2. Add a per-session "alive" partial unique index that guards against the
--      same (session_id, student_id) being marked PRESENT twice in
--      `present_only` mode. The state-machine guard in the service catches
--      this at insertion time; the index is a belt-and-braces safety net
--      against a race between two volunteers scanning the same student.
--      The full state machine for `in_out` mode allows alternating rows for
--      the same (session, student) pair, so the index targets only
--      `scan_kind = 'present'`.

-- ===== 1. client_op_id text widening =======================================
ALTER TABLE "shivir_attendance_scans"
  ALTER COLUMN "client_op_id" TYPE text USING "client_op_id"::text;
--> statement-breakpoint

-- ===== 2. Partial unique index for present-only sessions ==================
CREATE UNIQUE INDEX IF NOT EXISTS "shivir_scans_present_unique"
  ON "shivir_attendance_scans" ("shivir_session_id", "student_id")
  WHERE "scan_kind" = 'present';
