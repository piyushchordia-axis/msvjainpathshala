-- DB-9 (Notifications & Notices review, 2026-08) — push_receipts.expo_token
-- had no FK to device_push_tokens.expo_token. A receipt whose token row is
-- gone swept to nothing silently.
--
-- device_push_tokens.expo_token was only a plain unique INDEX
-- (device_push_tokens_token_unique) — Postgres refuses a foreign key against
-- an index that isn't backed by a real UNIQUE/PRIMARY KEY constraint
-- ("there is no unique constraint matching given keys"). Promote it to a
-- real constraint first, keeping the same name so nothing else that
-- references it by name needs to change.
ALTER TABLE device_push_tokens
  DROP CONSTRAINT IF EXISTS device_push_tokens_token_unique;--> statement-breakpoint
DROP INDEX IF EXISTS device_push_tokens_token_unique;--> statement-breakpoint
ALTER TABLE device_push_tokens
  ADD CONSTRAINT device_push_tokens_token_unique UNIQUE (expo_token);--> statement-breakpoint

-- device_push_tokens rows are soft-deactivated (is_active=false), never
-- hard-deleted, by convention (CLAUDE.md: never hard-delete). Guard against
-- any historical exception before adding the constraint so this migration
-- can't fail on drifted dev/prod data.
DELETE FROM push_receipts pr
WHERE NOT EXISTS (
  SELECT 1 FROM device_push_tokens dpt WHERE dpt.expo_token = pr.expo_token
);--> statement-breakpoint

ALTER TABLE push_receipts
  ADD CONSTRAINT push_receipts_expo_token_device_push_tokens_expo_token_fk
  FOREIGN KEY (expo_token) REFERENCES device_push_tokens(expo_token) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
