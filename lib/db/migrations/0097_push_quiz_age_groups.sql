-- M5/M6 — push quizzes can target age groups, like scheduled events already can.
--
-- quiz_events has carried age_groups since the start and the take flow honours
-- it, but push_quizzes never had the column: a Guruji running a live quiz for a
-- mixed-age batch could not aim it at the Bal group, and the eligible-count on
-- every roster ignored age targeting entirely, inflating the denominator so a
-- fully-answered quiz read as half-attended.
--
-- Empty array = every age group, matching quiz_events and quizMatchesStudent.

ALTER TABLE "push_quizzes"
  ADD COLUMN IF NOT EXISTS "age_groups" age_group_enum[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint

-- The take flow filters on this the same way it does for quiz_events.
CREATE INDEX IF NOT EXISTS "idx_push_quizzes_age_groups_gin"
  ON "push_quizzes" USING gin ("age_groups");
