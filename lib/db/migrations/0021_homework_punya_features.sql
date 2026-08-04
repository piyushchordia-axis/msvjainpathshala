-- AT21 homework Punya defaults: approved (10) and starred (12) as separate features.
INSERT INTO "punya_features" ("key", "label", "min_points", "max_points", "is_active")
SELECT 'homework', 'Homework approved', 0, 10, true
WHERE NOT EXISTS (SELECT 1 FROM "punya_features" WHERE "key" = 'homework');--> statement-breakpoint

INSERT INTO "punya_features" ("key", "label", "min_points", "max_points", "is_active")
SELECT 'homework_starred', 'Homework starred', 0, 12, true
WHERE NOT EXISTS (SELECT 1 FROM "punya_features" WHERE "key" = 'homework_starred');--> statement-breakpoint
