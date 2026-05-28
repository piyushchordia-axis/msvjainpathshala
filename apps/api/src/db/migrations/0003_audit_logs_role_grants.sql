-- Step 4 — audit_writer Postgres role + append-only grants on audit_logs.
--
-- SPEC §16 / CLAUDE.md "Database conventions → Audit logs": audit rows are
-- inserted by a dedicated `audit_writer` role that has INSERT (and nothing
-- else) on `audit_logs`. UPDATE / DELETE / TRUNCATE are revoked from PUBLIC.
--
-- The application's normal connection role gets MEMBERSHIP in audit_writer,
-- so service code can `SET ROLE audit_writer` immediately before emitting an
-- audit row (Step 7 worker does this). Without the membership grant the
-- application could not assume the role.

-- 1. Create the audit_writer role if it doesn't already exist.
--    (Local Docker init.sql creates it for fresh volumes; this block makes
--    the migration idempotent for prod-RDS where init.sql doesn't run.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_writer') THEN
    CREATE ROLE audit_writer NOLOGIN NOINHERIT;
  END IF;
END
$$;--> statement-breakpoint

-- 2. Lock down audit_logs against tampering by PUBLIC (default-deny model).
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM PUBLIC;--> statement-breakpoint

-- 3. Grant INSERT only to audit_writer (the only verb it ever needs).
GRANT INSERT ON "audit_logs" TO audit_writer;--> statement-breakpoint

-- 4. Allow the migration runner (CURRENT_USER) to SET ROLE audit_writer.
--    `format` quotes the role identifier safely; %I handles names with
--    special characters or mixed case.
DO $$
BEGIN
  EXECUTE format('GRANT audit_writer TO %I', CURRENT_USER);
END
$$;
