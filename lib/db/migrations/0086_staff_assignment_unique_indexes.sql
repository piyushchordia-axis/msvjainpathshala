-- Four partial unique indexes that exist in schema.ts but in NO migration, so
-- every database built by `pnpm db:migrate` was missing them. Found by the new
-- from-zero drift check (lib/db/scripts/check-migration-drift.mjs) — the same
-- class of push-only drift that hid the whole Niyam schema.
--
-- Without them a migrated database allows: the same sanchalak assigned twice to
-- one centre, the same shikshak assigned twice to one centre or batch, and more
-- than one "primary" shikshak on a batch. Dev/CI never noticed because they
-- build with `drizzle-kit push`, which reads schema.ts directly.
--
-- Duplicates are collapsed first (keep the newest row, deactivate the rest) so
-- index creation cannot fail on live data.

UPDATE "sanchalak_centre_assignments" a
SET "is_active" = false, "deactivated_at" = now(), "updated_at" = now()
WHERE a."is_active"
  AND EXISTS (
    SELECT 1 FROM "sanchalak_centre_assignments" b
    WHERE b."user_id" = a."user_id" AND b."centre_id" = a."centre_id"
      AND b."is_active" AND (b."created_at", b."id") > (a."created_at", a."id")
  );--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "sanchalak_centre_assignments_active_user_centre_uq"
  ON "sanchalak_centre_assignments" ("user_id", "centre_id") WHERE "is_active";--> statement-breakpoint

UPDATE "shikshak_centre_assignments" a
SET "is_active" = false, "deactivated_at" = now(), "updated_at" = now()
WHERE a."is_active"
  AND EXISTS (
    SELECT 1 FROM "shikshak_centre_assignments" b
    WHERE b."user_id" = a."user_id" AND b."centre_id" = a."centre_id"
      AND b."is_active" AND (b."created_at", b."id") > (a."created_at", a."id")
  );--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "shikshak_centre_assignments_active_user_centre_uq"
  ON "shikshak_centre_assignments" ("user_id", "centre_id") WHERE "is_active";--> statement-breakpoint

UPDATE "shikshak_batch_assignments" a
SET "is_active" = false, "deactivated_at" = now(), "updated_at" = now()
WHERE a."is_active"
  AND EXISTS (
    SELECT 1 FROM "shikshak_batch_assignments" b
    WHERE b."user_id" = a."user_id" AND b."batch_id" = a."batch_id"
      AND b."is_active" AND (b."created_at", b."id") > (a."created_at", a."id")
  );--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "shikshak_batch_assignments_active_user_batch_uq"
  ON "shikshak_batch_assignments" ("user_id", "batch_id") WHERE "is_active";--> statement-breakpoint

-- Demote extra primaries rather than deactivating the assignment: the teacher
-- still teaches the batch, they are simply no longer the primary.
UPDATE "shikshak_batch_assignments" a
SET "is_primary" = false, "updated_at" = now()
WHERE a."is_active" AND a."is_primary"
  AND EXISTS (
    SELECT 1 FROM "shikshak_batch_assignments" b
    WHERE b."batch_id" = a."batch_id" AND b."is_active" AND b."is_primary"
      AND (b."created_at", b."id") > (a."created_at", a."id")
  );--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "shikshak_batch_assignments_active_primary_uq"
  ON "shikshak_batch_assignments" ("batch_id") WHERE "is_active" AND "is_primary";
