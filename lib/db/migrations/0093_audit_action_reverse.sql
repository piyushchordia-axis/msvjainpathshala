-- M18 — a manual Punya award can now be reversed over HTTP, and that is a
-- distinct auditable act. Recording it as 'award' would make the append-only
-- log claim points were GIVEN at the moment they were taken back, which is the
-- one thing an audit log must never do.
--
-- Separate file: ALTER TYPE ... ADD VALUE is kept away from other DDL so a
-- retry cannot half-apply a mixed transaction (same reasoning as 0082).
ALTER TYPE "audit_action_enum" ADD VALUE IF NOT EXISTS 'reverse';
