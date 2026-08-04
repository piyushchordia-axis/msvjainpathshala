-- F1 + F9: extend homework_status_enum once.
-- acknowledged — parent mark-done without an upload artefact
-- returned     — Guruji handed work back for rework
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block on older
-- Postgres; IF NOT EXISTS keeps re-applies safe.

--> statement-breakpoint

ALTER TYPE "homework_status_enum" ADD VALUE IF NOT EXISTS 'acknowledged';

--> statement-breakpoint

ALTER TYPE "homework_status_enum" ADD VALUE IF NOT EXISTS 'returned';
