-- PERF #9 — drop indexes fully subsumed by a wider unique/composite index.
--
-- DROP INDEX CONCURRENTLY cannot run inside a transaction. Apply with:
--   node lib/db/scripts/apply-concurrent-migration.mjs 0038_drop_redundant_indexes
--
-- Verified against pg_stat_user_indexes before drop (dev DB):
--   idx_attendance_session              90325 scans — session_id lookups; covered by
--                                       attendance_session_student_unique leftmost prefix
--   idx_punya_transactions_student      4 scans — covered by student_created
--   idx_sessions_batch                  0 scans — covered by batch+scheduled_date unique
--   idx_absence_notifications_student   20 scans — covered by student_range unique
--   idx_homework_submissions_assignment 0 scans — covered by assignment+student unique
--   idx_exam_answers_attempt            85 scans — covered by attempt+question unique
--   idx_notifications_user              already dropped in 0036
--
-- Left alone (likely-dead / orphan — not in this commit):
--   idx_gallery_items_public, idx_attendance_student_absent_by_date
--   idx_batches_shikshak — index AND batches.shikshak_id column already absent in this DB

DROP INDEX CONCURRENTLY IF EXISTS idx_attendance_session;
DROP INDEX CONCURRENTLY IF EXISTS idx_punya_transactions_student;
DROP INDEX CONCURRENTLY IF EXISTS idx_sessions_batch;
DROP INDEX CONCURRENTLY IF EXISTS idx_absence_notifications_student;
DROP INDEX CONCURRENTLY IF EXISTS idx_homework_submissions_assignment;
DROP INDEX CONCURRENTLY IF EXISTS idx_exam_answers_attempt;
