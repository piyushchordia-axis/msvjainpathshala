ALTER TABLE "sessions" ADD COLUMN "gps_haversine_m" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "submission_op_id" char(26);--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_submission_op_id_ulid_check" CHECK ("sessions"."submission_op_id" is null or "sessions"."submission_op_id" ~ '^[0-9A-HJKMNP-TV-Z]{26}$');--> statement-breakpoint
CREATE INDEX "idx_sessions_shikshak_date" ON "sessions" USING btree ("shikshak_user_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "idx_sessions_date_status" ON "sessions" USING btree ("scheduled_date","status");
