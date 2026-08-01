-- N2b: punya bounds/city overrides, upload ownership registry.

--> statement-breakpoint

ALTER TABLE "punya_features" ADD COLUMN IF NOT EXISTS "min_points" integer;
--> statement-breakpoint
ALTER TABLE "punya_features" ADD COLUMN IF NOT EXISTS "max_points" integer;

--> statement-breakpoint

ALTER TABLE "punya_configs" ADD COLUMN IF NOT EXISTS "city_id" uuid;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "punya_configs"
    ADD CONSTRAINT "punya_configs_city_id_cities_id_fk"
    FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_punya_configs_feature_city"
  ON "punya_configs" ("feature_key", "city_id");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "upload_objects" (
  "key" text PRIMARY KEY NOT NULL,
  "uploaded_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "upload_objects"
    ADD CONSTRAINT "upload_objects_uploaded_by_users_id_fk"
    FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_upload_objects_uploaded_by"
  ON "upload_objects" ("uploaded_by");

--> statement-breakpoint

-- Bounds row used when validating niyam.points at create/update.
INSERT INTO "punya_features" ("key", "label", "min_points", "max_points", "is_active")
SELECT 'niyam_completion', 'Niyam completion', 0, 1000, true
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_features" WHERE "key" = 'niyam_completion'
);
