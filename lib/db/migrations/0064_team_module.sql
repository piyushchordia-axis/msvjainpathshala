-- Team module: categories + members (public directory).
-- Enums: team_scope_level, team_display_style, team_group_by.
-- featured display_style is reserved — renderers fall back to grid.

CREATE TYPE "public"."team_scope_level" AS ENUM('national', 'state', 'city', 'centre');
CREATE TYPE "public"."team_display_style" AS ENUM('featured', 'grid', 'list');
CREATE TYPE "public"."team_group_by" AS ENUM('none', 'centre');

CREATE TABLE "team_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "name_en" text NOT NULL,
  "name_hi" text NOT NULL,
  "order" integer DEFAULT 0 NOT NULL,
  "display_style" "public"."team_display_style" DEFAULT 'grid' NOT NULL,
  "group_by" "public"."team_group_by" DEFAULT 'none' NOT NULL,
  "is_lazy_loaded" boolean DEFAULT false NOT NULL,
  "is_published" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "team_categories_key_uq" ON "team_categories" ("key");

CREATE TABLE "team_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category_id" uuid NOT NULL,
  "user_id" uuid,
  "scope_level" "public"."team_scope_level" NOT NULL,
  "state_id" uuid,
  "city_id" uuid,
  "centre_id" uuid,
  "honorific" text,
  "display_name_en" text,
  "display_name_hi" text,
  "designation_en" text,
  "designation_hi" text,
  "bio_en" text,
  "bio_hi" text,
  -- SPEC media_assets.id — table not shipped yet; no FK.
  "photo_override_asset_id" uuid,
  "associated_since" integer,
  "is_in_memoriam" boolean DEFAULT false NOT NULL,
  "order" integer DEFAULT 0 NOT NULL,
  "is_published" boolean DEFAULT false NOT NULL,
  "published_at" timestamp with time zone,
  "content_version" integer DEFAULT 1 NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "team_members_category_id_team_categories_id_fk"
    FOREIGN KEY ("category_id") REFERENCES "public"."team_categories"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "team_members_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "team_members_state_id_states_id_fk"
    FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "team_members_city_id_cities_id_fk"
    FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "team_members_centre_id_centres_id_fk"
    FOREIGN KEY ("centre_id") REFERENCES "public"."centres"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "team_members_name_required"
    CHECK ("user_id" IS NOT NULL OR "display_name_en" IS NOT NULL),
  CONSTRAINT "team_members_scope_consistency"
    CHECK (
      ("scope_level" = 'national' AND "state_id" IS NULL AND "city_id" IS NULL AND "centre_id" IS NULL)
      OR ("scope_level" = 'state' AND "state_id" IS NOT NULL AND "city_id" IS NULL AND "centre_id" IS NULL)
      OR ("scope_level" = 'city' AND "state_id" IS NOT NULL AND "city_id" IS NOT NULL AND "centre_id" IS NULL)
      OR ("scope_level" = 'centre' AND "state_id" IS NOT NULL AND "city_id" IS NOT NULL AND "centre_id" IS NOT NULL)
    )
);

-- One active card per linked user, platform-wide.
CREATE UNIQUE INDEX "team_members_user_id_active_uq"
  ON "team_members" ("user_id")
  WHERE "user_id" IS NOT NULL AND "deleted_at" IS NULL;

-- City page: single indexed filter (city_id denormalised on centre-scoped rows).
CREATE INDEX "idx_team_members_city_published"
  ON "team_members" ("city_id", "is_published")
  WHERE "deleted_at" IS NULL;

CREATE INDEX "idx_team_members_centre"
  ON "team_members" ("centre_id")
  WHERE "deleted_at" IS NULL;

-- Seed default categories (idempotent on key). Order is authoritative for display.
INSERT INTO "team_categories" (
  "key", "name_en", "name_hi", "order", "display_style", "group_by",
  "is_lazy_loaded", "is_published"
) VALUES
  ('core_team', 'Core Team', 'मुख्य टीम', 1, 'grid', 'none', false, true),
  ('sanchalak', 'Sanchalak', 'संचालक', 2, 'grid', 'none', false, true),
  ('shikshak', 'Gurujis & Didis', 'गुरुजी एवं दीदी', 3, 'grid', 'centre', true, true)
ON CONFLICT ("key") DO NOTHING;
