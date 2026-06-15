ALTER TABLE "gallery_items" ALTER COLUMN "student_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gallery_items" ALTER COLUMN "niyam_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD COLUMN "thumbnail_url" text;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD COLUMN "caption" text;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD COLUMN "caption_hi" text;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enrolments_student_batch_active_uq" ON "enrolments" USING btree ("student_id","requested_batch_id") WHERE status <> 'rejected';--> statement-breakpoint
CREATE UNIQUE INDEX "notice_reads_notice_user_unique" ON "notice_reads" USING btree ("notice_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_notices_batch" ON "notices" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shivir_attendance_scans_session_student_kind_unique" ON "shivir_attendance_scans" USING btree ("shivir_session_id","student_id","scan_kind");--> statement-breakpoint
CREATE INDEX "idx_gallery_items_public" ON "gallery_items" USING btree ("is_public");