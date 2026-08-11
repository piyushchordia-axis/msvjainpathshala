-- Join / gan onboarding registration (Student / Shikshak / Sanchalak).

CREATE TABLE "join_form_fields" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "field_key" text NOT NULL,
  "label_hi" text NOT NULL,
  "label_en" text NOT NULL,
  "field_type" text DEFAULT 'text' NOT NULL,
  "options" jsonb,
  "placeholder_hi" text,
  "placeholder_en" text,
  "is_required" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX "join_form_fields_kind_key_uq" ON "join_form_fields" ("kind", "field_key");--> statement-breakpoint
CREATE INDEX "idx_join_form_fields_kind_order" ON "join_form_fields" ("kind", "display_order");--> statement-breakpoint

CREATE TABLE "join_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "key" text NOT NULL,
  "value" text NOT NULL,
  "label" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX "join_settings_kind_key_uq" ON "join_settings" ("kind", "key");--> statement-breakpoint

CREATE TABLE "join_student_registrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "display_code" varchar(32) NOT NULL,
  "city_id" uuid NOT NULL,
  "name" text NOT NULL,
  "mobile" text NOT NULL,
  "email" text,
  "father_name" text,
  "age" integer,
  "sex" text,
  "education" text,
  "address" text,
  "sang_name" text,
  "pathshala_nearby" text,
  "attended_last_season" text,
  "family_members" integer DEFAULT 1 NOT NULL,
  "will_attend" text DEFAULT 'yes' NOT NULL,
  "has_paid" text DEFAULT 'no' NOT NULL,
  "payment_note" text,
  "special_note" text,
  "photo_url" text,
  "payment_screenshot_url" text,
  "extra_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX "join_student_registrations_display_code_uq" ON "join_student_registrations" ("display_code");--> statement-breakpoint
CREATE INDEX "idx_join_student_registrations_city" ON "join_student_registrations" ("city_id");--> statement-breakpoint
CREATE INDEX "idx_join_student_registrations_mobile" ON "join_student_registrations" ("mobile");--> statement-breakpoint

ALTER TABLE "join_student_registrations"
  ADD CONSTRAINT "join_student_registrations_city_id_cities_id_fk"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "join_student_registrations" VALIDATE CONSTRAINT "join_student_registrations_city_id_cities_id_fk";--> statement-breakpoint

CREATE TABLE "join_shikshak_registrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "display_code" varchar(32) NOT NULL,
  "centre_id" uuid NOT NULL,
  "name" text NOT NULL,
  "s_o" text,
  "age" integer,
  "school_qualification" text,
  "address" text,
  "religious_education" text,
  "years_at_pathshala" integer,
  "current_pathshala" text,
  "vision" text,
  "whatsapp_contact" text NOT NULL,
  "pathshala_timing" text,
  "pathshala_name" text,
  "role" text,
  "photo_url" text,
  "has_paid" text DEFAULT 'no' NOT NULL,
  "payment_screenshot_url" text,
  "extra_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX "join_shikshak_registrations_display_code_uq" ON "join_shikshak_registrations" ("display_code");--> statement-breakpoint
CREATE INDEX "idx_join_shikshak_registrations_centre" ON "join_shikshak_registrations" ("centre_id");--> statement-breakpoint
CREATE INDEX "idx_join_shikshak_registrations_whatsapp" ON "join_shikshak_registrations" ("whatsapp_contact");--> statement-breakpoint

ALTER TABLE "join_shikshak_registrations"
  ADD CONSTRAINT "join_shikshak_registrations_centre_id_centres_id_fk"
  FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "join_shikshak_registrations" VALIDATE CONSTRAINT "join_shikshak_registrations_centre_id_centres_id_fk";--> statement-breakpoint

CREATE TABLE "join_sanchalak_registrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "display_code" varchar(32) NOT NULL,
  "centre_id" uuid NOT NULL,
  "name" text NOT NULL,
  "s_o" text,
  "age" integer,
  "school_qualification" text,
  "address" text,
  "religious_education" text,
  "years_at_pathshala" integer,
  "current_pathshala" text,
  "vision" text,
  "whatsapp_contact" text NOT NULL,
  "pathshala_timing" text,
  "pathshala_name" text,
  "role" text,
  "photo_url" text,
  "has_paid" text DEFAULT 'no' NOT NULL,
  "payment_screenshot_url" text,
  "extra_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX "join_sanchalak_registrations_display_code_uq" ON "join_sanchalak_registrations" ("display_code");--> statement-breakpoint
CREATE INDEX "idx_join_sanchalak_registrations_centre" ON "join_sanchalak_registrations" ("centre_id");--> statement-breakpoint
CREATE INDEX "idx_join_sanchalak_registrations_whatsapp" ON "join_sanchalak_registrations" ("whatsapp_contact");--> statement-breakpoint

ALTER TABLE "join_sanchalak_registrations"
  ADD CONSTRAINT "join_sanchalak_registrations_centre_id_centres_id_fk"
  FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE restrict ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "join_sanchalak_registrations" VALIDATE CONSTRAINT "join_sanchalak_registrations_centre_id_centres_id_fk";
