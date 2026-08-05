-- Exam Punya (SPEC §5.14 / AT21): per-exam point overrides + feature catalogue.

ALTER TABLE "online_exams" ADD COLUMN IF NOT EXISTS "completion_points" integer;--> statement-breakpoint

ALTER TABLE "online_exams" ADD COLUMN IF NOT EXISTS "top_score_points" integer;--> statement-breakpoint

INSERT INTO "punya_features" ("key", "label", "min_points", "max_points", "is_active")
SELECT 'exam_completion', 'Exam completion (pass)', 0, 500, true
WHERE NOT EXISTS (SELECT 1 FROM "punya_features" WHERE "key" = 'exam_completion');--> statement-breakpoint

INSERT INTO "punya_features" ("key", "label", "min_points", "max_points", "is_active")
SELECT 'exam_top_score', 'Exam top score', 0, 500, true
WHERE NOT EXISTS (SELECT 1 FROM "punya_features" WHERE "key" = 'exam_top_score');--> statement-breakpoint

-- Global defaults (AT21). Per-exam columns override; city configs override these.
INSERT INTO "punya_configs" ("feature_key", "points", "city_id", "is_active")
SELECT 'exam_completion', 20, NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_configs"
  WHERE "feature_key" = 'exam_completion' AND "city_id" IS NULL
);--> statement-breakpoint

INSERT INTO "punya_configs" ("feature_key", "points", "city_id", "is_active")
SELECT 'exam_top_score', 50, NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_configs"
  WHERE "feature_key" = 'exam_top_score' AND "city_id" IS NULL
);
