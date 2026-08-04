-- Homework Punya reversals (FIX #12): revision on submissions for AT18 keys.
ALTER TABLE "homework_submissions" ADD COLUMN IF NOT EXISTS "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
