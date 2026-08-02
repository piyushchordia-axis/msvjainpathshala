-- AT1 / attendance_status_enum: add 'excused'.
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block in PostgreSQL.
-- This migration is intentionally a single statement (or a no-op).
--
-- Baseline (0000) and the live database already include 'excused' in
-- attendance_status_enum ('present','absent','late','excused'). Adding it
-- again would error, so this file is a documented no-op rather than ADD VALUE.

SELECT 1;
