-- Notifications & Notices review, 2026-08:
--   SU-2 — notices had no deleted_at while students/batches/centres all do;
--     delete was a hard DELETE with no way to recover. Soft delete instead.
--   SU-3 — created_by was written but never selected, and there was no
--     updated_by at all; authorship was answerable only from audit_logs.
--   DB-4 — the six-way OR over audience in /feed and /admin had no access
--     path for the disjunction to use.
ALTER TABLE notices ADD COLUMN IF NOT EXISTS deleted_at timestamptz;--> statement-breakpoint
ALTER TABLE notices ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notices_audience ON notices (audience);--> statement-breakpoint
