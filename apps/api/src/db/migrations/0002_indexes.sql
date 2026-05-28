-- Step 4 — composite + partial perf indexes per SPEC §5.
-- Index names follow `idx_{table}_{cols}` for greppability; partial indexes
-- add a `_active` / `_pending` etc. suffix indicating the predicate.

-- ===== users =================================================================
CREATE INDEX "idx_users_role_city" ON "users" ("role", "city_id");--> statement-breakpoint
CREATE INDEX "idx_users_active" ON "users" ("id") WHERE "is_active" = true;--> statement-breakpoint

-- ===== device_sessions =======================================================
CREATE INDEX "idx_device_sessions_user_active" ON "device_sessions" ("user_id") WHERE "revoked_at" IS NULL;--> statement-breakpoint

-- ===== cities ================================================================
CREATE INDEX "idx_cities_state_name" ON "cities" ("state_id", "name");--> statement-breakpoint

-- ===== centres ===============================================================
CREATE INDEX "idx_centres_city_status" ON "centres" ("city_id", "status");--> statement-breakpoint
CREATE INDEX "idx_centres_lat_lng" ON "centres" ("lat", "lng");--> statement-breakpoint

-- ===== batches ===============================================================
CREATE INDEX "idx_batches_centre_status" ON "batches" ("centre_id", "status");--> statement-breakpoint
CREATE INDEX "idx_batches_shikshak" ON "batches" ("shikshak_id");--> statement-breakpoint

-- ===== shikshak_batch_assignments — partial unique (live only) ===============
CREATE UNIQUE INDEX "uq_shikshak_batch_live" ON "shikshak_batch_assignments" ("shikshak_user_id", "batch_id") WHERE "revoked_at" IS NULL;--> statement-breakpoint

-- ===== sanchalak_centre_assignments — partial unique (live only) =============
CREATE UNIQUE INDEX "uq_sanchalak_centre_live" ON "sanchalak_centre_assignments" ("sanchalak_user_id", "centre_id") WHERE "revoked_at" IS NULL;--> statement-breakpoint

-- ===== centre_holidays =======================================================
CREATE INDEX "idx_centre_holidays_centre_dates" ON "centre_holidays" ("centre_id", "start_date", "end_date");--> statement-breakpoint

-- ===== students ==============================================================
CREATE INDEX "idx_students_parent" ON "students" ("parent_user_id");--> statement-breakpoint
CREATE INDEX "idx_students_centre_status" ON "students" ("centre_id", "status");--> statement-breakpoint
CREATE INDEX "idx_students_batch_status" ON "students" ("batch_id", "status");--> statement-breakpoint
CREATE INDEX "idx_students_msv_approved" ON "students" ("msv_status") WHERE "msv_status" = 'approved';--> statement-breakpoint

-- ===== sessions ==============================================================
CREATE INDEX "idx_sessions_batch_date" ON "sessions" ("batch_id", "scheduled_date");--> statement-breakpoint
CREATE INDEX "idx_sessions_shikshak_date" ON "sessions" ("shikshak_user_id", "scheduled_date");--> statement-breakpoint
CREATE INDEX "idx_sessions_date_status" ON "sessions" ("scheduled_date", "status");--> statement-breakpoint

-- ===== attendance ============================================================
CREATE INDEX "idx_attendance_student_marked_desc" ON "attendance" ("student_id", "marked_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_attendance_session" ON "attendance" ("session_id");--> statement-breakpoint
CREATE INDEX "idx_attendance_absent" ON "attendance" ("student_id") WHERE "status" = 'absent';--> statement-breakpoint

-- ===== absence_notifications ================================================
CREATE INDEX "idx_absence_notifications_student_date" ON "absence_notifications" ("student_id", "expected_date");--> statement-breakpoint

-- ===== punya_transactions ====================================================
CREATE INDEX "idx_punya_student_awarded" ON "punya_transactions" ("student_id", "awarded_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_punya_city_awarded" ON "punya_transactions" ("city_id", "awarded_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_punya_batch_awarded" ON "punya_transactions" ("batch_id", "awarded_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_punya_msv_city" ON "punya_transactions" ("city_id", "is_msv_track", "awarded_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_punya_reversals" ON "punya_transactions" ("reversal_of") WHERE "reversal_of" IS NOT NULL;--> statement-breakpoint

-- ===== niyams ================================================================
CREATE INDEX "idx_niyams_city_start" ON "niyams" ("city_id", "start_date");--> statement-breakpoint
CREATE INDEX "idx_niyams_msv_only" ON "niyams" ("msv_only");--> statement-breakpoint
CREATE INDEX "idx_niyams_type" ON "niyams" ("type");--> statement-breakpoint

-- ===== niyam_submissions =====================================================
CREATE INDEX "idx_niyam_subs_niyam_student_date" ON "niyam_submissions" ("niyam_id", "student_id", "submission_date");--> statement-breakpoint
CREATE INDEX "idx_niyam_subs_student_submitted_desc" ON "niyam_submissions" ("student_id", "submitted_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_niyam_subs_active" ON "niyam_submissions" ("id") WHERE "rejected_at" IS NULL;--> statement-breakpoint

-- ===== gallery_items =========================================================
CREATE INDEX "idx_gallery_city_featured_created" ON "gallery_items" ("city_id", "is_featured", "created_at" DESC);--> statement-breakpoint

-- ===== homework_assignments ==================================================
CREATE INDEX "idx_homework_assignments_batch_due_desc" ON "homework_assignments" ("batch_id", "due_date" DESC);--> statement-breakpoint

-- ===== homework_submissions ==================================================
CREATE INDEX "idx_homework_subs_student_status" ON "homework_submissions" ("student_id", "status");--> statement-breakpoint

-- ===== notices ===============================================================
CREATE INDEX "idx_notices_scope_city_published" ON "notices" ("scope", "city_id", "published_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_notices_batch_published" ON "notices" ("batch_id", "published_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_notices_public" ON "notices" ("id") WHERE "is_public" = true;--> statement-breakpoint

-- ===== shivir_events =========================================================
CREATE INDEX "idx_shivir_events_city_start" ON "shivir_events" ("city_id", "start_date");--> statement-breakpoint

-- ===== shivir_attendance_scans ==============================================
CREATE INDEX "idx_shivir_scans_session_student" ON "shivir_attendance_scans" ("shivir_session_id", "student_id");--> statement-breakpoint
CREATE INDEX "idx_shivir_scans_event_scanned" ON "shivir_attendance_scans" ("shivir_event_id", "scanned_at" DESC);--> statement-breakpoint

-- ===== service_requests ======================================================
CREATE INDEX "idx_service_requests_city_status" ON "service_requests" ("city_id", "status");--> statement-breakpoint
CREATE INDEX "idx_service_requests_parent_created" ON "service_requests" ("parent_user_id", "created_at" DESC);--> statement-breakpoint

-- ===== library_items =========================================================
CREATE INDEX "idx_library_access_tier" ON "library_items" ("access_tier");--> statement-breakpoint
CREATE INDEX "idx_library_content_type" ON "library_items" ("content_type");--> statement-breakpoint
CREATE INDEX "idx_library_tags_gin" ON "library_items" USING GIN ("tags");--> statement-breakpoint

-- ===== library_access_logs ===================================================
CREATE INDEX "idx_library_access_item_at" ON "library_access_logs" ("item_id", "at" DESC);--> statement-breakpoint

-- ===== donations =============================================================
CREATE INDEX "idx_donations_donor_phone" ON "donations" ("donor_phone");--> statement-breakpoint
CREATE INDEX "idx_donations_campaign" ON "donations" ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_donations_status" ON "donations" ("status");--> statement-breakpoint
CREATE INDEX "idx_donations_captured" ON "donations" ("payment_captured_at" DESC);--> statement-breakpoint

-- ===== notifications =========================================================
CREATE INDEX "idx_notifications_user_unread_created" ON "notifications" ("user_id", "is_read", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_notifications_pending" ON "notifications" ("id") WHERE "status" = 'pending';--> statement-breakpoint

-- ===== audit_logs ============================================================
CREATE INDEX "idx_audit_logs_entity" ON "audit_logs" ("entity_kind", "entity_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_audit_logs_actor" ON "audit_logs" ("actor_user_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_audit_logs_created" ON "audit_logs" ("created_at" DESC);--> statement-breakpoint

-- ===== media_assets ==========================================================
CREATE INDEX "idx_media_assets_owner_kind" ON "media_assets" ("owner_user_id", "kind");--> statement-breakpoint
CREATE INDEX "idx_media_assets_pending" ON "media_assets" ("id") WHERE "status" = 'pending';--> statement-breakpoint

-- ===== online_exams ==========================================================
CREATE INDEX "idx_online_exams_city_window" ON "online_exams" ("city_id", "window_start");--> statement-breakpoint

-- ===== exam_attempts =========================================================
CREATE INDEX "idx_exam_attempts_exam_student" ON "exam_attempts" ("exam_id", "student_id");--> statement-breakpoint

-- ===== enrolments — deferred FK to registration_form_responses (cycle break) ==
ALTER TABLE "enrolments"
  ADD CONSTRAINT "enrolments_form_response_id_fk"
  FOREIGN KEY ("form_response_id")
  REFERENCES "registration_form_responses"("id")
  ON DELETE SET NULL;--> statement-breakpoint

-- ===== msv_enrolments — deferred FK to registration_form_responses ===========
ALTER TABLE "msv_enrolments"
  ADD CONSTRAINT "msv_enrolments_application_fk"
  FOREIGN KEY ("application_form_response_id")
  REFERENCES "registration_form_responses"("id")
  ON DELETE SET NULL;
