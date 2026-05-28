-- Step 18 — Homework, Notices, Competitions
--
-- Five deltas:
--   1. Add `competitions.max_participants` (nullable int) so the registration
--      service can enforce a capacity cap when set.
--   2. Add `competitions.results_published_at` so the parent UI knows when
--      results went live (and the audit page can pivot on the moment).
--   3. Index `homework_submissions(assignment_id)` for the "all submissions
--      for this assignment" page (the unique index covers `assignment_id +
--      student_id` but the leading column alone is still fine for B-tree
--      prefix scans; we add a dedicated index because Postgres' planner
--      prefers a narrower index for this kind of selective lookup).
--   4. Index `homework_submissions(student_id, late)` so the parent "late
--      homework count" badge stays fast.
--   5. Index `notices` for the parent-feed access pattern:
--      WHERE city_id=? AND published_at <= now() ORDER BY pinned DESC,
--      published_at DESC. Existing `idx_notices_scope_city_published` is
--      scope-prefixed so it loses to a sequential scan once the table grows.
--
-- All blocks are idempotent.

-- ===== 1. competitions.max_participants ===================================
ALTER TABLE "competitions"
  ADD COLUMN IF NOT EXISTS "max_participants" integer;--> statement-breakpoint

-- ===== 2. competitions.results_published_at ===============================
ALTER TABLE "competitions"
  ADD COLUMN IF NOT EXISTS "results_published_at" timestamp with time zone;--> statement-breakpoint

-- ===== 3. homework_submissions assignment lookup ==========================
CREATE INDEX IF NOT EXISTS "idx_homework_subs_assignment"
  ON "homework_submissions" ("assignment_id");--> statement-breakpoint

-- ===== 4. homework_submissions late badge =================================
CREATE INDEX IF NOT EXISTS "idx_homework_subs_student_late"
  ON "homework_submissions" ("student_id", "late")
  WHERE "late" = true;--> statement-breakpoint

-- ===== 5. notices city feed ==============================================
CREATE INDEX IF NOT EXISTS "idx_notices_city_pinned_published"
  ON "notices" ("city_id", "pinned" DESC, "published_at" DESC)
  WHERE "deleted_at" IS NULL;--> statement-breakpoint

-- ===== 6. notices scheduled publisher ====================================
-- The cron processor reads scheduled_for <= now() AND published_at IS NULL
-- — a small partial index makes the lookup constant-time.
CREATE INDEX IF NOT EXISTS "idx_notices_due_to_publish"
  ON "notices" ("scheduled_for")
  WHERE "published_at" IS NULL AND "scheduled_for" IS NOT NULL AND "deleted_at" IS NULL;
