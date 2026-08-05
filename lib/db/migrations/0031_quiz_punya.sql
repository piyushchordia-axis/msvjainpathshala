-- Quiz Punya (AT21): feature catalogue + nullable per-event/push overrides.
-- Historical punya_transactions with feature_key 'quiz' / 'push_quiz' are left intact.

ALTER TABLE "quiz_events" ALTER COLUMN "participation_points" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_events" ALTER COLUMN "participation_points" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "quiz_events" ALTER COLUMN "win_points" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_events" ALTER COLUMN "win_points" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "push_quizzes" ALTER COLUMN "completion_points" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "push_quizzes" ALTER COLUMN "completion_points" DROP DEFAULT;--> statement-breakpoint

INSERT INTO "punya_features" ("key", "label", "min_points", "max_points", "is_active")
SELECT 'quiz_participation', 'Quiz participation', 0, 5, true
WHERE NOT EXISTS (SELECT 1 FROM "punya_features" WHERE "key" = 'quiz_participation');--> statement-breakpoint

INSERT INTO "punya_features" ("key", "label", "min_points", "max_points", "is_active")
SELECT 'quiz_win', 'Quiz win', 0, 25, true
WHERE NOT EXISTS (SELECT 1 FROM "punya_features" WHERE "key" = 'quiz_win');--> statement-breakpoint

INSERT INTO "punya_features" ("key", "label", "min_points", "max_points", "is_active")
SELECT 'push_quiz_completion', 'Push quiz completion', 0, 5, true
WHERE NOT EXISTS (SELECT 1 FROM "punya_features" WHERE "key" = 'push_quiz_completion');--> statement-breakpoint

-- Global defaults (AT21). Per-event/push columns override; city configs override these.
INSERT INTO "punya_configs" ("feature_key", "points", "city_id", "is_active")
SELECT 'quiz_participation', 5, NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_configs"
  WHERE "feature_key" = 'quiz_participation' AND "city_id" IS NULL
);--> statement-breakpoint

INSERT INTO "punya_configs" ("feature_key", "points", "city_id", "is_active")
SELECT 'quiz_win', 25, NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_configs"
  WHERE "feature_key" = 'quiz_win' AND "city_id" IS NULL
);--> statement-breakpoint

INSERT INTO "punya_configs" ("feature_key", "points", "city_id", "is_active")
SELECT 'push_quiz_completion', 5, NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_configs"
  WHERE "feature_key" = 'push_quiz_completion' AND "city_id" IS NULL
);--> statement-breakpoint
