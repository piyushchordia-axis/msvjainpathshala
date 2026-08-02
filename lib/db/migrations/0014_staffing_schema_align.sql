-- Align staffing tables with Drizzle schema (scope resolution depends on these).

CREATE TABLE IF NOT EXISTS "shikshak_centre_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"centre_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"assigned_by" uuid,
	"deactivated_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "shikshak_centre_assignments" ADD CONSTRAINT "shikshak_centre_assignments_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "shikshak_centre_assignments" ADD CONSTRAINT "shikshak_centre_assignments_centre_id_centres_id_fk"
    FOREIGN KEY ("centre_id") REFERENCES "public"."centres"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_shikshak_centre_assignments_user" ON "shikshak_centre_assignments" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shikshak_centre_assignments_centre" ON "shikshak_centre_assignments" ("centre_id");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "shikshak_centre_assignments_active_user_centre_uq"
  ON "shikshak_centre_assignments" ("user_id", "centre_id") WHERE is_active;--> statement-breakpoint

ALTER TABLE "shikshak_batch_assignments" ADD COLUMN IF NOT EXISTS "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shikshak_batch_assignments" ADD COLUMN IF NOT EXISTS "assigned_by" uuid;--> statement-breakpoint
ALTER TABLE "shikshak_batch_assignments" ADD COLUMN IF NOT EXISTS "deactivated_at" timestamptz;--> statement-breakpoint

ALTER TABLE "sanchalak_centre_assignments" ADD COLUMN IF NOT EXISTS "assigned_by" uuid;--> statement-breakpoint
ALTER TABLE "sanchalak_centre_assignments" ADD COLUMN IF NOT EXISTS "deactivated_at" timestamptz;
