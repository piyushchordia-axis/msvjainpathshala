-- Step 19 — Curriculum & Online Exams
--
-- Four deltas:
--   1. Seed `curriculum_mastered` punya feature so the optional Punya award on
--      `progressUpsert(level='mastered')` has a catalogue row to reference
--      (CLAUDE.md Q11 "never award without a catalogue row").
--   2. Seed `exam_top_score` punya feature — Step 11 (0011) seeded
--      `exam_completion`, but the release-results pipeline needs a separate
--      key for the top-N reward (per online_exams.top_score_points).
--   3. Backfill bounds on the freshly-seeded keys (matches the 0.5x..3x
--      envelope used by 0011).
--   4. Indexes for the hot paths we are about to introduce:
--        - curriculum_assignments(batch_id, curriculum_id) — service-layer
--          conflict check "one active Standard + one active MSV per batch".
--        - student_curriculum_progress(curriculum_item_id) — shikshak's
--          "all students for this item" panel.
--        - exam_attempts(exam_id, status) — admin grading queue + ranking.
--        - exam_attempts(student_id, exam_id) — parent re-entry / max-attempts.
--        - exam_answers(attempt_id, question_id) — UPSERT path on autosave.
--
-- All blocks are idempotent.

-- ===== 1+2. punya_features seeds ==========================================
INSERT INTO "punya_features"
  ("key", "default_points", "is_manual", "requires_reason", "scope",
   "min_points", "max_points", "created_at", "updated_at")
VALUES
  ('curriculum_mastered',     20, false, false, 'global', 10, 50,  now(), now()),
  ('exam_top_score',          50, false, false, 'global', 25, 150, now(), now())
ON CONFLICT ("key") DO UPDATE
  SET min_points = COALESCE(EXCLUDED.min_points, punya_features.min_points),
      max_points = COALESCE(EXCLUDED.max_points, punya_features.max_points),
      updated_at = now();--> statement-breakpoint

-- ===== 3. curriculum_assignments — unique (batch_id, curriculum_id) ========
-- Prevents inserting the SAME curriculum twice on the same batch. The
-- "one active Standard + one active MSV per batch" rule is enforced at the
-- service layer (Curricula.assign joins curricula on `status='active'`).
CREATE UNIQUE INDEX IF NOT EXISTS "idx_curric_assign_batch_curriculum_unique"
  ON "curriculum_assignments" ("batch_id", "curriculum_id")
  WHERE "batch_id" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_curric_assign_centre_curriculum_unique"
  ON "curriculum_assignments" ("centre_id", "curriculum_id")
  WHERE "centre_id" IS NOT NULL AND "batch_id" IS NULL;--> statement-breakpoint

-- ===== 4. student_curriculum_progress — per-item lookup ====================
CREATE INDEX IF NOT EXISTS "idx_student_curric_progress_item"
  ON "student_curriculum_progress" ("curriculum_item_id");--> statement-breakpoint

-- ===== 5. exam_attempts — admin grading queue + ranking ====================
CREATE INDEX IF NOT EXISTS "idx_exam_attempts_exam_status"
  ON "exam_attempts" ("exam_id", "status");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_exam_attempts_student_exam"
  ON "exam_attempts" ("student_id", "exam_id");--> statement-breakpoint

-- ===== 6. exam_answers — UPSERT on autosave ================================
-- The autosave path UPSERTs by (attempt_id, question_id). A unique index makes
-- ON CONFLICT (attempt_id, question_id) DO UPDATE possible.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_exam_answers_attempt_question_unique"
  ON "exam_answers" ("attempt_id", "question_id");
