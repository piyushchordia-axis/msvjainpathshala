-- CU1-CU29 curriculum -> courses schema (populated-table safe).
-- Authored as the drizzle-kit generate rewrite (same pattern as 0009) for:
--   - table/column renames (not drop/recreate)
--   - mandatory status backfill: ALL existing rows -> 'draft' (CU4 landmine)
--   - name -> name_en backfill; name_hi left NULL (CU5)
--   - CASCADE FKs -> RESTRICT (CU29)
--   - student_course_progress unique -> two partial indexes (CU9)
--   - every new FK/CHECK as NOT VALID then VALIDATE (ACCESS EXCLUSIVE avoidance)

/* ---- Enums ---- */
CREATE TYPE "public"."course_status_enum" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint

/* ---- Templates (new) ---- */
CREATE TABLE "course_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name_en" text NOT NULL,
  "name_hi" text,
  "kind" text DEFAULT 'standard' NOT NULL,
  "age_group" "age_group_enum",
  "created_by" uuid,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "course_template_sections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_id" uuid NOT NULL,
  "title_en" text NOT NULL,
  "title_hi" text NOT NULL,
  "order_index" integer DEFAULT 0 NOT NULL,
  "punya_points" integer DEFAULT 0 NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "course_template_subsections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "section_id" uuid NOT NULL,
  "title_en" text NOT NULL,
  "title_hi" text NOT NULL,
  "description_en" text,
  "description_hi" text,
  "order_index" integer DEFAULT 0 NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX "idx_course_templates_kind" ON "course_templates" ("kind");--> statement-breakpoint
CREATE INDEX "idx_course_template_sections_template" ON "course_template_sections" ("template_id");--> statement-breakpoint
CREATE INDEX "idx_course_template_subsections_section" ON "course_template_subsections" ("section_id");--> statement-breakpoint

ALTER TABLE "course_templates"
  ADD CONSTRAINT "course_templates_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "course_templates" VALIDATE CONSTRAINT "course_templates_created_by_users_id_fk";--> statement-breakpoint

ALTER TABLE "course_template_sections"
  ADD CONSTRAINT "course_template_sections_template_id_course_templates_id_fk"
  FOREIGN KEY ("template_id") REFERENCES "course_templates"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "course_template_sections" VALIDATE CONSTRAINT "course_template_sections_template_id_course_templates_id_fk";--> statement-breakpoint

ALTER TABLE "course_template_subsections"
  ADD CONSTRAINT "course_template_subsections_section_id_course_template_sections_id_fk"
  FOREIGN KEY ("section_id") REFERENCES "course_template_sections"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "course_template_subsections" VALIDATE CONSTRAINT "course_template_subsections_section_id_course_template_sections_id_fk";--> statement-breakpoint

ALTER TABLE "course_template_sections"
  ADD CONSTRAINT "course_template_sections_punya_points_check"
  CHECK ("punya_points" >= 0 AND "punya_points" <= 1000) NOT VALID;--> statement-breakpoint
ALTER TABLE "course_template_sections" VALIDATE CONSTRAINT "course_template_sections_punya_points_check";--> statement-breakpoint

/* ---- Rename tree (CU1) ---- */
ALTER TABLE "curricula" RENAME TO "courses";--> statement-breakpoint
ALTER TABLE "curriculum_sections" RENAME TO "course_sections";--> statement-breakpoint
ALTER TABLE "curriculum_items" RENAME TO "course_subsections";--> statement-breakpoint
ALTER TABLE "student_curriculum_progress" RENAME TO "student_course_progress";--> statement-breakpoint

ALTER TABLE "course_sections" RENAME COLUMN "curriculum_id" TO "course_id";--> statement-breakpoint
ALTER TABLE "courses" RENAME COLUMN "name" TO "name_en";--> statement-breakpoint
ALTER TABLE "student_course_progress" RENAME COLUMN "curriculum_item_id" TO "subsection_id";--> statement-breakpoint
ALTER TABLE "student_course_progress" RENAME COLUMN "level" TO "status";--> statement-breakpoint
ALTER TABLE "homework_assignments" RENAME COLUMN "curriculum_item_id" TO "subsection_id";--> statement-breakpoint

/* Rename indexes that still carry old names */
ALTER INDEX IF EXISTS "idx_curricula_city" RENAME TO "idx_courses_city";--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_curriculum_sections_curriculum" RENAME TO "idx_course_sections_course";--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_curriculum_items_section" RENAME TO "idx_course_subsections_section";--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_student_curriculum_progress_student" RENAME TO "idx_student_course_progress_student";--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_student_curriculum_progress_item" RENAME TO "idx_student_course_progress_subsection";--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_homework_assignments_curriculum_item" RENAME TO "idx_homework_assignments_subsection";--> statement-breakpoint

/* ---- courses: bilingual, lifecycle enum, template provenance, soft-delete, punya (CU4/CU5/CU22/CU29) ---- */
ALTER TABLE "courses" ADD COLUMN "name_hi" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "punya_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint

-- LANDMINE (CU4): every existing row is text 'active'. Changing only the default
-- would leave them nationally visible. Force ALL existing rows to draft first.
UPDATE "courses" SET "status" = 'draft';--> statement-breakpoint

ALTER TABLE "courses" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "courses"
  ALTER COLUMN "status" TYPE "course_status_enum"
  USING "status"::"course_status_enum";--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "status" SET DEFAULT 'draft'::"course_status_enum";--> statement-breakpoint

CREATE INDEX "idx_courses_status" ON "courses" ("status");--> statement-breakpoint

ALTER TABLE "courses"
  ADD CONSTRAINT "courses_template_id_course_templates_id_fk"
  FOREIGN KEY ("template_id") REFERENCES "course_templates"("id") ON DELETE set null ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "courses" VALIDATE CONSTRAINT "courses_template_id_course_templates_id_fk";--> statement-breakpoint

ALTER TABLE "courses"
  ADD CONSTRAINT "courses_punya_points_check"
  CHECK ("punya_points" >= 0 AND "punya_points" <= 2000) NOT VALID;--> statement-breakpoint
ALTER TABLE "courses" VALIDATE CONSTRAINT "courses_punya_points_check";--> statement-breakpoint

/* ---- course_sections: punya + soft-delete (CU22/CU29) ---- */
ALTER TABLE "course_sections" ADD COLUMN "punya_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "course_sections" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "course_sections"
  ADD CONSTRAINT "course_sections_punya_points_check"
  CHECK ("punya_points" >= 0 AND "punya_points" <= 1000) NOT VALID;--> statement-breakpoint
ALTER TABLE "course_sections" VALIDATE CONSTRAINT "course_sections_punya_points_check";--> statement-breakpoint

/* ---- course_subsections: soft-delete (CU29) ---- */
ALTER TABLE "course_subsections" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint

/* ---- student_course_progress: CU9 shape ---- */
ALTER TABLE "student_course_progress" ALTER COLUMN "subsection_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "student_course_progress" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "student_course_progress" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "student_course_progress" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "student_course_progress" ADD COLUMN "certified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "student_course_progress" ADD COLUMN "certified_by" uuid;--> statement-breakpoint
ALTER TABLE "student_course_progress" ADD COLUMN "certification_note" text;--> statement-breakpoint
ALTER TABLE "student_course_progress" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Historical writers were shikshak-only; required for CU9 NOT NULL.
ALTER TABLE "student_course_progress" ADD COLUMN "updated_by_role" text;--> statement-breakpoint
UPDATE "student_course_progress" SET "updated_by_role" = 'shikshak' WHERE "updated_by_role" IS NULL;--> statement-breakpoint
ALTER TABLE "student_course_progress" ALTER COLUMN "updated_by_role" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "student_course_progress" ADD COLUMN "client_op_id" char(26);--> statement-breakpoint
ALTER TABLE "student_course_progress" ADD COLUMN "client_marked_at" timestamp with time zone;--> statement-breakpoint

-- Drop old unique (NULLs are distinct — would stop constraining section rows).
DROP INDEX IF EXISTS "student_curriculum_progress_student_item_unique";--> statement-breakpoint

CREATE UNIQUE INDEX "student_course_progress_subsection_unique"
  ON "student_course_progress" ("student_id", "subsection_id")
  WHERE "subsection_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "student_course_progress_section_unique"
  ON "student_course_progress" ("student_id", "section_id")
  WHERE "section_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "student_course_progress_client_op_id_unique"
  ON "student_course_progress" ("client_op_id")
  WHERE "client_op_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_student_course_progress_section" ON "student_course_progress" ("section_id");--> statement-breakpoint

/* ---- CU29: swap four CASCADE FKs → RESTRICT ---- */
ALTER TABLE "course_sections"
  DROP CONSTRAINT IF EXISTS "curriculum_sections_curriculum_id_curricula_id_fk";--> statement-breakpoint
ALTER TABLE "course_sections"
  ADD CONSTRAINT "course_sections_course_id_courses_id_fk"
  FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "course_sections" VALIDATE CONSTRAINT "course_sections_course_id_courses_id_fk";--> statement-breakpoint

ALTER TABLE "course_subsections"
  DROP CONSTRAINT IF EXISTS "curriculum_items_section_id_curriculum_sections_id_fk";--> statement-breakpoint
ALTER TABLE "course_subsections"
  ADD CONSTRAINT "course_subsections_section_id_course_sections_id_fk"
  FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "course_subsections" VALIDATE CONSTRAINT "course_subsections_section_id_course_sections_id_fk";--> statement-breakpoint

ALTER TABLE "student_course_progress"
  DROP CONSTRAINT IF EXISTS "student_curriculum_progress_student_id_students_id_fk";--> statement-breakpoint
ALTER TABLE "student_course_progress"
  ADD CONSTRAINT "student_course_progress_student_id_students_id_fk"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "student_course_progress" VALIDATE CONSTRAINT "student_course_progress_student_id_students_id_fk";--> statement-breakpoint

ALTER TABLE "student_course_progress"
  DROP CONSTRAINT IF EXISTS "student_curriculum_progress_curriculum_item_id_curriculum_items_id_fk";--> statement-breakpoint
ALTER TABLE "student_course_progress"
  ADD CONSTRAINT "student_course_progress_subsection_id_course_subsections_id_fk"
  FOREIGN KEY ("subsection_id") REFERENCES "course_subsections"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "student_course_progress" VALIDATE CONSTRAINT "student_course_progress_subsection_id_course_subsections_id_fk";--> statement-breakpoint

ALTER TABLE "student_course_progress"
  ADD CONSTRAINT "student_course_progress_section_id_course_sections_id_fk"
  FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "student_course_progress" VALIDATE CONSTRAINT "student_course_progress_section_id_course_sections_id_fk";--> statement-breakpoint

ALTER TABLE "student_course_progress"
  ADD CONSTRAINT "student_course_progress_certified_by_users_id_fk"
  FOREIGN KEY ("certified_by") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "student_course_progress" VALIDATE CONSTRAINT "student_course_progress_certified_by_users_id_fk";--> statement-breakpoint

-- Rename leftover updated_by FK if still under old name
ALTER TABLE "student_course_progress"
  DROP CONSTRAINT IF EXISTS "student_curriculum_progress_updated_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "student_course_progress"
  ADD CONSTRAINT "student_course_progress_updated_by_users_id_fk"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "student_course_progress" VALIDATE CONSTRAINT "student_course_progress_updated_by_users_id_fk";--> statement-breakpoint

/* homework advisory FK — keep SET NULL (CU29); retarget renamed tables */
ALTER TABLE "homework_assignments"
  DROP CONSTRAINT IF EXISTS "homework_assignments_curriculum_item_id_curriculum_items_id_fk";--> statement-breakpoint
ALTER TABLE "homework_assignments"
  DROP CONSTRAINT IF EXISTS "homework_assignments_curriculum_item_id_fkey";--> statement-breakpoint
ALTER TABLE "homework_assignments"
  ADD CONSTRAINT "homework_assignments_subsection_id_course_subsections_id_fk"
  FOREIGN KEY ("subsection_id") REFERENCES "course_subsections"("id") ON DELETE set null ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "homework_assignments" VALIDATE CONSTRAINT "homework_assignments_subsection_id_course_subsections_id_fk";--> statement-breakpoint

/* cities FK on courses may still carry old constraint name */
ALTER TABLE "courses"
  DROP CONSTRAINT IF EXISTS "curricula_city_id_cities_id_fk";--> statement-breakpoint
ALTER TABLE "courses"
  ADD CONSTRAINT "courses_city_id_cities_id_fk"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "courses" VALIDATE CONSTRAINT "courses_city_id_cities_id_fk";--> statement-breakpoint

/* ---- CU9 CHECKs (NOT VALID → VALIDATE) ---- */
ALTER TABLE "student_course_progress"
  ADD CONSTRAINT "student_course_progress_one_node"
  CHECK (num_nonnulls("section_id", "subsection_id") = 1) NOT VALID;--> statement-breakpoint
ALTER TABLE "student_course_progress" VALIDATE CONSTRAINT "student_course_progress_one_node";--> statement-breakpoint

ALTER TABLE "student_course_progress"
  ADD CONSTRAINT "student_course_progress_certified_pair"
  CHECK (num_nonnulls("certified_at", "certified_by") IN (0, 2)) NOT VALID;--> statement-breakpoint
ALTER TABLE "student_course_progress" VALIDATE CONSTRAINT "student_course_progress_certified_pair";--> statement-breakpoint

ALTER TABLE "student_course_progress"
  ADD CONSTRAINT "student_course_progress_certified_requires_completed"
  CHECK ("certified_at" IS NULL OR "status" = 'completed') NOT VALID;--> statement-breakpoint
ALTER TABLE "student_course_progress" VALIDATE CONSTRAINT "student_course_progress_certified_requires_completed";--> statement-breakpoint

ALTER TABLE "student_course_progress"
  ADD CONSTRAINT "student_course_progress_client_op_id_format"
  CHECK ("client_op_id" IS NULL OR "client_op_id" ~ '^[0-9A-HJKMNP-TV-Z]{26}$') NOT VALID;--> statement-breakpoint
ALTER TABLE "student_course_progress" VALIDATE CONSTRAINT "student_course_progress_client_op_id_format";--> statement-breakpoint

/* ---- course_certificates (CU24) ---- */
CREATE TABLE "course_certificates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "student_id" uuid NOT NULL,
  "course_id" uuid NOT NULL,
  "section_id" uuid,
  "kind" text NOT NULL,
  "verification_code" char(12) NOT NULL,
  "scope_snapshot" jsonb NOT NULL,
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "voided_at" timestamp with time zone,
  "voided_by" uuid,
  "storage_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX "course_certificates_section_unique"
  ON "course_certificates" ("student_id", "section_id")
  WHERE "section_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "course_certificates_course_unique"
  ON "course_certificates" ("student_id", "course_id")
  WHERE "section_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "course_certificates_code_unique"
  ON "course_certificates" ("verification_code");--> statement-breakpoint

ALTER TABLE "course_certificates"
  ADD CONSTRAINT "course_certificates_student_id_students_id_fk"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "course_certificates" VALIDATE CONSTRAINT "course_certificates_student_id_students_id_fk";--> statement-breakpoint

ALTER TABLE "course_certificates"
  ADD CONSTRAINT "course_certificates_course_id_courses_id_fk"
  FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "course_certificates" VALIDATE CONSTRAINT "course_certificates_course_id_courses_id_fk";--> statement-breakpoint

ALTER TABLE "course_certificates"
  ADD CONSTRAINT "course_certificates_section_id_course_sections_id_fk"
  FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "course_certificates" VALIDATE CONSTRAINT "course_certificates_section_id_course_sections_id_fk";--> statement-breakpoint

ALTER TABLE "course_certificates"
  ADD CONSTRAINT "course_certificates_voided_by_users_id_fk"
  FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "course_certificates" VALIDATE CONSTRAINT "course_certificates_voided_by_users_id_fk";--> statement-breakpoint

ALTER TABLE "course_certificates"
  ADD CONSTRAINT "course_certificates_kind_check"
  CHECK ("kind" IN ('section', 'course')) NOT VALID;--> statement-breakpoint
ALTER TABLE "course_certificates" VALIDATE CONSTRAINT "course_certificates_kind_check";--> statement-breakpoint

ALTER TABLE "course_certificates"
  ADD CONSTRAINT "course_certificates_kind_section_pair"
  CHECK (
    ("kind" = 'section' AND "section_id" IS NOT NULL)
    OR ("kind" = 'course' AND "section_id" IS NULL)
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "course_certificates" VALIDATE CONSTRAINT "course_certificates_kind_section_pair";--> statement-breakpoint

/* ---- CU22 seed: city multipliers as integer percent (100 = 1×) ---- */
INSERT INTO "punya_features" ("key", "label", "min_points", "max_points", "is_active")
SELECT 'course_section_certified', 'Course section certified', 0, 1000, true
WHERE NOT EXISTS (SELECT 1 FROM "punya_features" WHERE "key" = 'course_section_certified');--> statement-breakpoint

INSERT INTO "punya_features" ("key", "label", "min_points", "max_points", "is_active")
SELECT 'course_completed', 'Course completed', 0, 2000, true
WHERE NOT EXISTS (SELECT 1 FROM "punya_features" WHERE "key" = 'course_completed');--> statement-breakpoint

INSERT INTO "punya_configs" ("feature_key", "points", "city_id", "is_active")
SELECT 'course_section_certified', 100, NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_configs"
  WHERE "feature_key" = 'course_section_certified' AND "city_id" IS NULL
);--> statement-breakpoint

INSERT INTO "punya_configs" ("feature_key", "points", "city_id", "is_active")
SELECT 'course_completed', 100, NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_configs"
  WHERE "feature_key" = 'course_completed' AND "city_id" IS NULL
);--> statement-breakpoint
