-- Manual admin award (AT21): feature catalogue + per-role award ceilings.

INSERT INTO "punya_features" ("key", "label", "min_points", "max_points", "is_active")
SELECT 'manual_award', 'Manual admin award', 0, 500, true
WHERE NOT EXISTS (SELECT 1 FROM "punya_features" WHERE "key" = 'manual_award');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "punya_award_limits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "role" text NOT NULL,
  "max_points_per_award" integer NOT NULL,
  "max_points_per_day" integer,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "punya_award_limits_role_unique" UNIQUE ("role")
);--> statement-breakpoint

INSERT INTO "punya_award_limits" ("role", "max_points_per_award", "max_points_per_day", "is_active")
SELECT v.role, v.max_points_per_award, v.max_points_per_day, true
FROM (VALUES
  ('shikshak', 10, 50),
  ('sanchalak', 25, 150),
  ('city_admin', 100, 500),
  ('state_admin', 250, 1000),
  ('super_admin', 500, NULL)
) AS v(role, max_points_per_award, max_points_per_day)
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_award_limits" WHERE "role" = v.role
);
