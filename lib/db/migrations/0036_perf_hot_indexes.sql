-- PERF #6 — hot-path indexes.
--
-- IMPORTANT: every statement uses CONCURRENTLY and CANNOT run inside a
-- transaction block. `drizzle-kit migrate` wraps each migration file in a
-- transaction, so this file must be applied with autocommit (see
-- lib/db/scripts/apply-concurrent-migration.mjs) and then recorded in
-- drizzle.__drizzle_migrations. Do NOT `pnpm db:migrate` this file alone.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_punya_transactions_created
  ON punya_transactions (created_at DESC)
  INCLUDE (student_id, points);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_submission_op
  ON sessions (submission_op_id, shikshak_user_id)
  WHERE submission_op_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_in_progress
  ON sessions (scheduled_date)
  WHERE status = 'in_progress';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_student_session_date
  ON attendance (student_id, session_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

-- Subsumed by idx_notifications_user_created (and by idx_notifications_user_read).
DROP INDEX CONCURRENTLY IF EXISTS idx_notifications_user;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_students_birthday
  ON students ((EXTRACT(MONTH FROM dob)), (EXTRACT(DAY FROM dob)))
  WHERE status = 'active' AND deleted_at IS NULL;
