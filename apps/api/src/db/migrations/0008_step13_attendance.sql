-- Step 13 — Attendance & GPS Check-In (Phase 1 Capstone)
--
-- Two minor schema deltas land the attendance pipeline:
--   1. Extend `attendance_status_enum` with 'excused' so the marking UI can
--      pre-fill students with an advance-absence notification (SPEC §5.6 +
--      Step 13 prompt: "Pre-fill excused from absence_notifications").
--   2. Seed the additional Punya streak-milestone feature keys consumed by
--      `attendance.post_process` (SPEC §13.4 — defaults 20/40/80/150/250).
--
-- Performance indexes (sessions(batch_id,date), attendance(client_op_id) etc)
-- already exist in 0001/0002 — see attendance.ts schema + 0002_indexes.sql.

-- ===== 1. Extend attendance_status_enum =====================================
-- Postgres ALTER TYPE ADD VALUE is non-transactional in older versions but
-- safe-idempotent with IF NOT EXISTS in PG12+.
ALTER TYPE "attendance_status_enum" ADD VALUE IF NOT EXISTS 'excused';--> statement-breakpoint

-- ===== 2. Punya feature keys for attendance streak milestones ===============
-- 0004 already seeded `attendance_present`, `streak_bonus_7day`,
-- `streak_bonus_30day`. We add the finer-grained milestones the
-- attendance.post_process processor uses (7/14/30/60/100). The 7-day and
-- 30-day rows overlap with the existing streak_bonus_*day keys; we keep
-- both so existing consumers (niyam streaks) don't break, while the
-- attendance pipeline uses the `attendance_streak_*` namespace.
INSERT INTO "punya_features"
  ("key", "default_points", "is_manual", "requires_reason", "scope",
   "created_at", "updated_at")
VALUES
  ('attendance_streak_7',   20, false, false, 'global', now(), now()),
  ('attendance_streak_14',  40, false, false, 'global', now(), now()),
  ('attendance_streak_30',  80, false, false, 'global', now(), now()),
  ('attendance_streak_60', 150, false, false, 'global', now(), now()),
  ('attendance_streak_100',250, false, false, 'global', now(), now())
ON CONFLICT ("key") DO NOTHING;
