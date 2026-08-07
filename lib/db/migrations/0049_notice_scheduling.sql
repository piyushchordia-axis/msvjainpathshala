ALTER TABLE notices ADD COLUMN expires_at timestamptz;
ALTER TABLE notices ADD CONSTRAINT notices_expires_after_publish
  CHECK (expires_at IS NULL OR published_at IS NULL OR expires_at > published_at);

-- Feed queries filter on (published_at, expires_at) on every read.
-- Not partial on `expires_at > now()`: Postgres requires IMMUTABLE predicates
-- for partial indexes, and now() is STABLE.
CREATE INDEX idx_notices_active ON notices (published_at DESC, expires_at);
