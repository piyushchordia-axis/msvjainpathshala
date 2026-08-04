-- F12: advisory curriculum topic on homework assignments (SET NULL on item delete).
-- Does not write student_curriculum_progress.

ALTER TABLE "homework_assignments"
  ADD COLUMN IF NOT EXISTS "curriculum_item_id" uuid
  REFERENCES "curriculum_items"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_homework_assignments_curriculum_item"
  ON "homework_assignments" ("curriculum_item_id");
