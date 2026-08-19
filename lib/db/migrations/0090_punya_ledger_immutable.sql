-- M17 — enforce the append-only ledger at the database.
--
-- punya_transactions was "financial-grade, append-only" by convention only. No
-- production code UPDATEs or DELETEs it, but nothing stopped one: no trigger, no
-- rule, no REVOKE, unlike audit_logs which has a dedicated INSERT-only role. A
-- single stray UPDATE corrupts the ledger, and punya.reconcile then rebuilds
-- punya_balances around the corrupted row and makes it authoritative -- the
-- safety net laundering the damage into the record.
--
-- Corrections are already expressed as new negative rows carrying reversal_of
-- (AT18), so nothing in the product needs UPDATE or DELETE here.
--
-- Escape hatch for a genuine DBA repair, deliberately transaction-local:
--
--   BEGIN;
--   SELECT set_config('jp.ledger_maintenance', 'on', true);  -- true = tx-scoped
--   ...;
--   COMMIT;
--
-- Transaction-local matters on a pooled connection: a session-scoped flag would
-- return to the pool still set and silently disarm the guard for whatever ran
-- next on that connection.

CREATE OR REPLACE FUNCTION punya_ledger_is_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('jp.ledger_maintenance', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  RAISE EXCEPTION
    'punya_transactions is append-only: % is not permitted (id %). Write a reversal row instead (AT18).',
    TG_OP, OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS punya_transactions_append_only ON "punya_transactions";--> statement-breakpoint

CREATE TRIGGER punya_transactions_append_only
BEFORE UPDATE OR DELETE ON "punya_transactions"
FOR EACH ROW
EXECUTE FUNCTION punya_ledger_is_append_only();
