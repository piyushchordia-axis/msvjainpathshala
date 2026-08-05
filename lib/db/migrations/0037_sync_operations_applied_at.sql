-- PERF #8 — index for sync_operations retention prune.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction. Do NOT apply via
-- `pnpm db:migrate` alone — use:
--   node lib/db/scripts/apply-concurrent-migration.mjs 0037_sync_operations_applied_at

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sync_operations_applied
  ON sync_operations (applied_at)
  WHERE status IN ('success', 'duplicate');
