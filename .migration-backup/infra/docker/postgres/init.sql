-- Jain Pathshala — local Postgres bootstrap.
--
-- This file is executed once, when the postgres container initialises an empty
-- data volume (it lives at /docker-entrypoint-initdb.d/init.sql:ro).
--
-- Application schema migrations are managed by Drizzle (see apps/api/drizzle/);
-- nothing here should compete with those. We only set up the extensions and
-- the audit_writer role that Drizzle migrations later GRANT against
-- (SPEC.md §5 + §16; CLAUDE.md "Database conventions → Audit logs").

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- legacy UUID helpers
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive text (emails)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram search for names/notes

-- Append-only audit log writer role. Created here so it exists before any
-- Drizzle migration tries to GRANT INSERT ON audit_logs TO audit_writer.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_writer') THEN
    CREATE ROLE audit_writer NOLOGIN;
  END IF;
END
$$;
