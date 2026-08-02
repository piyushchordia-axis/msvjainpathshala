-- Deterministic attendance reversal target (source_revision) + sync claim status.

ALTER TABLE "punya_transactions" ADD COLUMN IF NOT EXISTS "source_revision" integer;--> statement-breakpoint

-- Backfill from known idempotency_key formats (one-time data migration).
UPDATE "punya_transactions"
SET "source_revision" = CASE
  WHEN "source_entity_kind" = 'attendance'
       AND "idempotency_key" ~ '^attendance:[^:]+:[^:]+:[0-9]+$'
    THEN (substring("idempotency_key" from ':([0-9]+)$'))::integer
  WHEN "source_entity_kind" = 'attendance'
       AND "idempotency_key" ~ '^attendance:[^:]+:[^:]+:[0-9]+:rev$'
    THEN (substring("idempotency_key" from ':([0-9]+):rev$'))::integer
  WHEN "source_entity_kind" = 'attendance_streak'
       AND "idempotency_key" ~ '^attendance_streak:[^:]+:[^:]+:rev:[0-9]+$'
    THEN (substring("idempotency_key" from ':rev:([0-9]+)$'))::integer
  ELSE NULL
END
WHERE "source_revision" IS NULL
  AND "idempotency_key" IS NOT NULL
  AND "source_entity_kind" IN ('attendance', 'attendance_streak');--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_punya_tx_source_revision"
  ON "punya_transactions" ("student_id", "source_entity_kind", "source_entity_id", "source_revision" DESC NULLS LAST);--> statement-breakpoint

ALTER TYPE "public"."sync_op_status_enum" ADD VALUE IF NOT EXISTS 'processing';
