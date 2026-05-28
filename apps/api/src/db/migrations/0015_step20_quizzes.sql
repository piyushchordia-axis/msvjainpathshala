-- Step 20 — Quizzes (Scheduled + Push)
--
-- Five deltas:
--   1. Seed two punya features the quiz pipelines reference at runtime:
--        - quiz_completion        20pt, 10..50 envelope, non-manual
--        - push_quiz_completion   10pt, 5..30 envelope, non-manual
--      `quiz_participation` and `quiz_top_score` already exist (0011).
--   2. Add `is_ai_generated` (boolean) and `ai_review_status` (text) columns
--      to `questions` so AI-generated questions enter pending_review and are
--      not visible to the quiz event flow until a super_admin approves.
--   3. Add `ai_generation_jobs` table to track the AI quiz-generation poll
--      status + the drafted questions awaiting review (SPEC §6.18).
--   4. Add `correct_indices_marker` placeholder logic for push_quiz_attempts:
--      the per-question answer rows are stored in `answers` jsonb on the
--      attempt. We also add `push_quiz_id_idx` for the live leaderboard read.
--   5. Indexes:
--        - questions(ai_review_status) WHERE ai_review_status='pending_review'
--        - push_quiz_attempts(push_quiz_id, student_id) UNIQUE — one attempt
--          row per student per push quiz (so concurrent answer submissions
--          UPSERT into the same row deterministically).
--        - push_quizzes(batch_id, started_at desc) for the active-quiz lookup.
--        - quiz_events(scope, city_id, start_at) for the parent listing.
--
-- All blocks are idempotent.

-- ===== 1. punya_features seeds ============================================
INSERT INTO "punya_features"
  ("key", "default_points", "is_manual", "requires_reason", "scope",
   "min_points", "max_points", "created_at", "updated_at")
VALUES
  ('quiz_completion',      20, false, false, 'global', 10, 50, now(), now()),
  ('push_quiz_completion', 10, false, false, 'global', 5,  30, now(), now())
ON CONFLICT ("key") DO UPDATE
  SET min_points = COALESCE(EXCLUDED.min_points, punya_features.min_points),
      max_points = COALESCE(EXCLUDED.max_points, punya_features.max_points),
      updated_at = now();--> statement-breakpoint

-- ===== 2. questions table — AI review status ==============================
ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "is_ai_generated" boolean NOT NULL DEFAULT false;--> statement-breakpoint

ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "ai_review_status" text;--> statement-breakpoint

-- Backfill: existing rows are manual + approved.
UPDATE "questions"
   SET "is_ai_generated" = false,
       "ai_review_status" = 'approved'
 WHERE "ai_review_status" IS NULL;--> statement-breakpoint

-- ===== 3. ai_generation_jobs ==============================================
CREATE TABLE IF NOT EXISTS "ai_generation_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "topic" text NOT NULL,
  "age_group" age_group_enum,
  "language" language_enum NOT NULL DEFAULT 'en',
  "count" integer NOT NULL DEFAULT 10,
  "status" text NOT NULL DEFAULT 'queued',
  "result_question_ids" uuid[],
  "error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_ai_gen_jobs_actor"
  ON "ai_generation_jobs" ("actor_user_id", "created_at" DESC);--> statement-breakpoint

-- ===== 4. push_quiz_attempts — one row per (push_quiz, student) ============
CREATE UNIQUE INDEX IF NOT EXISTS "idx_push_quiz_attempts_quiz_student_unique"
  ON "push_quiz_attempts" ("push_quiz_id", "student_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_push_quizzes_batch_started"
  ON "push_quizzes" ("batch_id", "started_at" DESC);--> statement-breakpoint

-- ===== 5. questions — fast pending-review lookup ==========================
CREATE INDEX IF NOT EXISTS "idx_questions_ai_review_status"
  ON "questions" ("ai_review_status")
  WHERE "ai_review_status" = 'pending_review';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_quiz_events_scope_city_start"
  ON "quiz_events" ("scope", "city_id", "start_at" DESC);

