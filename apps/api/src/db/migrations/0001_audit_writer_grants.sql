-- Grant audit_writer the INSERT-only privilege on audit_logs.
--
-- The `audit_writer` role itself is created by infra/docker/postgres/init.sql
-- (and is expected to exist on managed Postgres via an out-of-band CREATE
-- ROLE), but the GRANTs were never landed in any migration — every audit
-- write was failing with `permission denied for table audit_logs`.
--
-- INSERT-only by design (SPEC §5.1 + CLAUDE.md "Database conventions →
-- Audit logs"): the role MUST NOT be able to UPDATE or DELETE rows, so we
-- explicitly grant only INSERT, plus the schema USAGE bit and a membership
-- grant from the app owner so SET LOCAL ROLE succeeds.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_writer') THEN
    CREATE ROLE audit_writer NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO audit_writer;
--> statement-breakpoint
GRANT INSERT ON audit_logs TO audit_writer;
--> statement-breakpoint
-- Allow the connecting user (drizzle write pool) to assume audit_writer via
-- SET LOCAL ROLE. CURRENT_USER is the connection's role at migration time.
DO $$
BEGIN
  EXECUTE format('GRANT audit_writer TO %I', current_user);
END
$$;
