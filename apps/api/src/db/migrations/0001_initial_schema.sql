CREATE TYPE "public"."age_group_enum" AS ENUM('bal', 'kishor', 'tarun', 'yuva');--> statement-breakpoint
CREATE TYPE "public"."attendance_status_enum" AS ENUM('present', 'absent', 'late');--> statement-breakpoint
CREATE TYPE "public"."audit_action_enum" AS ENUM('create', 'update', 'delete', 'approve', 'reject', 'transfer', 'login', 'logout', 'config_change');--> statement-breakpoint
CREATE TYPE "public"."curriculum_level_enum" AS ENUM('not_started', 'in_progress', 'completed', 'mastered');--> statement-breakpoint
CREATE TYPE "public"."donation_frequency_enum" AS ENUM('one_time', 'recurring');--> statement-breakpoint
CREATE TYPE "public"."donation_purpose_enum" AS ENUM('general', 'shivir', 'scholarship', 'infrastructure');--> statement-breakpoint
CREATE TYPE "public"."enrolment_status_enum" AS ENUM('pending', 'approved', 'rejected', 'waitlisted');--> statement-breakpoint
CREATE TYPE "public"."exam_question_type_enum" AS ENUM('mcq_single', 'mcq_multi', 'true_false', 'short_text', 'image_based');--> statement-breakpoint
CREATE TYPE "public"."gender_enum" AS ENUM('male', 'female', 'other');--> statement-breakpoint
CREATE TYPE "public"."homework_status_enum" AS ENUM('pending', 'starred', 'approved', 'late');--> statement-breakpoint
CREATE TYPE "public"."language_enum" AS ENUM('en', 'hi');--> statement-breakpoint
CREATE TYPE "public"."library_access_tier_enum" AS ENUM('public', 'student', 'msv', 'shikshak');--> statement-breakpoint
CREATE TYPE "public"."library_content_type_enum" AS ENUM('pdf', 'video', 'audio', 'image');--> statement-breakpoint
CREATE TYPE "public"."media_kind_enum" AS ENUM('niyam_proof', 'student_photo', 'shikshak_photo', 'sanchalak_photo', 'library_pdf', 'library_audio', 'library_image', 'homework_attachment', 'notice_attachment', 'gallery_featured', 'misc');--> statement-breakpoint
CREATE TYPE "public"."media_status_enum" AS ENUM('pending', 'uploaded', 'processing', 'ready', 'failed', 'quarantined');--> statement-breakpoint
CREATE TYPE "public"."msv_status_enum" AS ENUM('none', 'applied', 'waitlisted', 'approved', 'rejected', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."niyam_submission_status_enum" AS ENUM('auto_approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."niyam_type_enum" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."notice_audience_enum" AS ENUM('batch', 'centre', 'city', 'state', 'national', 'msv');--> statement-breakpoint
CREATE TYPE "public"."notification_channel_enum" AS ENUM('push', 'sms', 'email', 'in_app');--> statement-breakpoint
CREATE TYPE "public"."notification_status_enum" AS ENUM('pending', 'sent', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_status_enum" AS ENUM('created', 'authorized', 'captured', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."proof_type_enum" AS ENUM('photo', 'video', 'either');--> statement-breakpoint
CREATE TYPE "public"."quiz_scope_enum" AS ENUM('national', 'state', 'city', 'centre', 'batch');--> statement-breakpoint
CREATE TYPE "public"."role_enum" AS ENUM('super_admin', 'state_admin', 'city_admin', 'sanchalak', 'shikshak', 'parent', 'student', 'guest');--> statement-breakpoint
CREATE TYPE "public"."service_request_status_enum" AS ENUM('submitted', 'in_review', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."session_status_enum" AS ENUM('scheduled', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."shivir_attendance_mode_enum" AS ENUM('in_out', 'present_only');--> statement-breakpoint
CREATE TYPE "public"."shivir_scan_kind_enum" AS ENUM('check_in', 'check_out', 'present');--> statement-breakpoint
CREATE TYPE "public"."student_status_enum" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."sync_op_status_enum" AS ENUM('success', 'duplicate', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tier_enum" AS ENUM('jigyasu', 'shravak', 'sadhak', 'shraman', 'tirthankar');--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"platform" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"token" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_otp_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(15) NOT NULL,
	"ip" varchar(45),
	"otp_hash" text NOT NULL,
	"attempts_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"succeeded_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_token_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_session_id" uuid NOT NULL,
	"current_token_hash" text NOT NULL,
	"rotation_count" integer DEFAULT 0 NOT NULL,
	"last_rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(15) NOT NULL,
	"email" varchar(255),
	"role" "role_enum" NOT NULL,
	"full_name" text NOT NULL,
	"gender" "gender_enum",
	"preferred_language" "language_enum" DEFAULT 'en' NOT NULL,
	"profile_photo_asset_id" uuid,
	"state_id" uuid,
	"city_id" uuid,
	"centre_id_default" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"gallery_visibility_opt_in" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "media_kind_enum" NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"s3_bucket" text NOT NULL,
	"s3_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_seconds" integer,
	"thumbnail_s3_key" text,
	"status" "media_status_enum" NOT NULL,
	"exif_stripped" boolean DEFAULT false NOT NULL,
	"virus_scan_status" text,
	"processed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"centre_id" uuid NOT NULL,
	"name" text NOT NULL,
	"day_of_week" integer[] NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"age_group" "age_group_enum" NOT NULL,
	"shikshak_id" uuid,
	"academic_year" text,
	"status" text DEFAULT 'active' NOT NULL,
	"capacity" integer DEFAULT 50 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "centre_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"centre_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"notify_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "centres" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address_line" text,
	"locality" text,
	"pincode" varchar(10),
	"lat" numeric(10, 7),
	"lng" numeric(10, 7),
	"gps_radius_m" integer DEFAULT 150 NOT NULL,
	"contact_phone" varchar(15),
	"contact_email" varchar(255),
	"status" text DEFAULT 'active' NOT NULL,
	"academic_year" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "sanchalak_centre_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sanchalak_user_id" uuid NOT NULL,
	"centre_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shikshak_batch_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shikshak_user_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"role_in_batch" text NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digital_id_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"card_number" text NOT NULL,
	"qr_payload" text NOT NULL,
	"qr_payload_signature" text NOT NULL,
	"png_asset_id" uuid,
	"svg_payload" text,
	"msv_badge" boolean DEFAULT false NOT NULL,
	"version_no" integer NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"last_regenerated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrolments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid,
	"parent_user_id" uuid NOT NULL,
	"requested_centre_id" uuid NOT NULL,
	"requested_batch_id" uuid NOT NULL,
	"status" "enrolment_status_enum" NOT NULL,
	"reviewer_user_id" uuid,
	"decided_at" timestamp with time zone,
	"rejection_reason" text,
	"form_response_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "msv_enrolments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"application_form_response_id" uuid,
	"motivation_statement_redacted" text,
	"recommending_shikshak_id" uuid,
	"status" "msv_status_enum" NOT NULL,
	"reviewer_user_id" uuid,
	"decided_at" timestamp with time zone,
	"certificate_year" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_user_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"father_name" text,
	"dob" date NOT NULL,
	"age_group" "age_group_enum" NOT NULL,
	"profile_photo_asset_id" uuid,
	"centre_id" uuid NOT NULL,
	"batch_id" uuid,
	"student_code" text NOT NULL,
	"msv_status" "msv_status_enum" DEFAULT 'none' NOT NULL,
	"status" "student_status_enum" DEFAULT 'active' NOT NULL,
	"enrolled_at" timestamp with time zone NOT NULL,
	"deactivated_at" timestamp with time zone,
	"student_view_enabled" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "registration_form_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid,
	"form_kind" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version_no" integer NOT NULL,
	"base_field_overrides" jsonb,
	"custom_fields" jsonb,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "registration_form_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_config_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"responses" jsonb NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "absence_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"parent_user_id" uuid NOT NULL,
	"expected_session_id" uuid,
	"expected_date" date NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "attendance_status_enum" NOT NULL,
	"marked_at" timestamp with time zone NOT NULL,
	"marked_by" uuid NOT NULL,
	"client_op_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_cancellations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"cancelled_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"cancelled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"scheduled_date" date NOT NULL,
	"scheduled_start_time" time NOT NULL,
	"scheduled_end_time" time NOT NULL,
	"status" "session_status_enum" DEFAULT 'scheduled' NOT NULL,
	"shikshak_user_id" uuid,
	"check_in_at" timestamp with time zone,
	"check_in_lat" numeric(10, 7),
	"check_in_lng" numeric(10, 7),
	"check_in_distance_m" integer,
	"check_out_at" timestamp with time zone,
	"check_out_lat" numeric(10, 7),
	"check_out_lng" numeric(10, 7),
	"duration_minutes" integer,
	"gps_haversine_m" integer,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"cancellation_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaderboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"period" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "punya_balances" (
	"student_id" uuid PRIMARY KEY NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	"msv_points" integer DEFAULT 0 NOT NULL,
	"current_tier" "tier_enum" DEFAULT 'jigyasu' NOT NULL,
	"tier_reached_at" timestamp with time zone,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "punya_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"feature_id" uuid NOT NULL,
	"points_override" integer NOT NULL,
	"min_points" integer,
	"max_points" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "punya_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"default_points" integer NOT NULL,
	"is_manual" boolean DEFAULT false NOT NULL,
	"requires_reason" boolean DEFAULT false NOT NULL,
	"scope" text DEFAULT 'global' NOT NULL,
	"min_points" integer,
	"max_points" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "punya_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"points" integer NOT NULL,
	"reason" text,
	"awarded_by_user_id" uuid,
	"source_entity_kind" text NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"reversal_of" uuid,
	"is_msv_track" boolean DEFAULT false NOT NULL,
	"awarded_at" timestamp with time zone NOT NULL,
	"city_id" uuid NOT NULL,
	"centre_id" uuid,
	"batch_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "niyam_streaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"niyam_id" uuid NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"last_completion_date" date,
	"badge_awarded" boolean DEFAULT false NOT NULL,
	"badge_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "niyam_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"niyam_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"parent_user_id" uuid NOT NULL,
	"proof_asset_id" uuid NOT NULL,
	"status" "niyam_submission_status_enum" DEFAULT 'auto_approved' NOT NULL,
	"auto_approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rejected_at" timestamp with time zone,
	"rejected_by_user_id" uuid,
	"rejection_reason" text,
	"punya_transaction_id" uuid NOT NULL,
	"reversal_transaction_id" uuid,
	"submitted_at" timestamp with time zone NOT NULL,
	"submission_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "niyams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title_en" text NOT NULL,
	"title_hi" text NOT NULL,
	"description_en" text,
	"description_hi" text,
	"type" "niyam_type_enum" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"audience_kind" text DEFAULT 'all' NOT NULL,
	"audience_filters" jsonb,
	"proof_type" "proof_type_enum" NOT NULL,
	"points_value" integer NOT NULL,
	"reference_asset_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"msv_only" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gallery_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"niyam_submission_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"centre_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"niyam_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"featured_at" timestamp with time zone,
	"removed" boolean DEFAULT false NOT NULL,
	"removed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "homework_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_date" date NOT NULL,
	"attachment_asset_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"is_msv" boolean DEFAULT false NOT NULL,
	"target_student_ids" uuid[],
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homework_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "homework_status_enum" NOT NULL,
	"submission_asset_id" uuid,
	"feedback_note" text,
	"marked_by_user_id" uuid,
	"marked_at" timestamp with time zone,
	"late" boolean DEFAULT false NOT NULL,
	"punya_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notice_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notice_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "notice_audience_enum" NOT NULL,
	"city_id" uuid NOT NULL,
	"centre_id" uuid,
	"batch_id" uuid,
	"msv_only" boolean DEFAULT false NOT NULL,
	"content_en" text NOT NULL,
	"content_hi" text NOT NULL,
	"attachments" jsonb,
	"pinned" boolean DEFAULT false NOT NULL,
	"scheduled_for" timestamp with time zone,
	"published_at" timestamp with time zone,
	"is_public" boolean DEFAULT false NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"send_sms" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shivir_attendance_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shivir_event_id" uuid NOT NULL,
	"shivir_session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"volunteer_user_id" uuid NOT NULL,
	"scan_kind" "shivir_scan_kind_enum" NOT NULL,
	"scanned_at" timestamp with time zone NOT NULL,
	"client_op_id" uuid,
	"device_offline" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shivir_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"location_text" text,
	"location_lat" numeric(10, 7),
	"location_lng" numeric(10, 7),
	"capacity" integer,
	"msv_only" boolean DEFAULT false NOT NULL,
	"attendance_mode" "shivir_attendance_mode_enum" NOT NULL,
	"sessions_count" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "shivir_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shivir_event_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"registered_at" timestamp with time zone NOT NULL,
	"registered_by_user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shivir_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shivir_event_id" uuid NOT NULL,
	"day_number" integer NOT NULL,
	"session_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shivir_volunteers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shivir_event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_by" uuid NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competition_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"registered_at" timestamp with time zone NOT NULL,
	"result_rank" integer,
	"result_note" text,
	"punya_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_hi" text NOT NULL,
	"description_en" text,
	"description_hi" text,
	"category" text,
	"eligible_age_groups" "age_group_enum"[],
	"msv_only" boolean DEFAULT false NOT NULL,
	"registration_window_start" timestamp with time zone,
	"registration_window_end" timestamp with time zone,
	"event_date" date,
	"winner_points" integer DEFAULT 0 NOT NULL,
	"participant_points" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "curricula" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid,
	"kind" text NOT NULL,
	"template_id" uuid,
	"name" text NOT NULL,
	"academic_year" text,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "curriculum_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_id" uuid NOT NULL,
	"centre_id" uuid,
	"batch_id" uuid,
	"assigned_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curriculum_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"title_en" text NOT NULL,
	"title_hi" text NOT NULL,
	"description_en" text,
	"description_hi" text,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curriculum_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_id" uuid NOT NULL,
	"title_en" text NOT NULL,
	"title_hi" text NOT NULL,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curriculum_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"age_group" "age_group_enum",
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_curriculum_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"curriculum_item_id" uuid NOT NULL,
	"level" "curriculum_level_enum" DEFAULT 'not_started' NOT NULL,
	"updated_by_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"selected_option_ids" uuid[],
	"short_text_answer" text,
	"auto_score" integer,
	"manual_score" integer,
	"admin_comment" text,
	"graded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"score" integer,
	"auto_score" integer,
	"manual_score" integer,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"otp_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_question_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"label_en" text NOT NULL,
	"label_hi" text NOT NULL,
	"is_correct" boolean NOT NULL,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_id" uuid NOT NULL,
	"question_type" "exam_question_type_enum" NOT NULL,
	"question_en" text NOT NULL,
	"question_hi" text NOT NULL,
	"marks" integer NOT NULL,
	"image_asset_id" uuid,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "online_exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"title_en" text NOT NULL,
	"title_hi" text NOT NULL,
	"description_en" text,
	"description_hi" text,
	"target_audience" jsonb,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"total_marks" integer NOT NULL,
	"pass_mark" integer NOT NULL,
	"exam_otp" text,
	"completion_points" integer DEFAULT 0 NOT NULL,
	"top_score_points" integer DEFAULT 0 NOT NULL,
	"results_released" boolean DEFAULT false NOT NULL,
	"show_rank" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "push_quiz_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"push_quiz_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"answers" jsonb,
	"score" integer,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_quiz_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"push_quiz_id" uuid NOT NULL,
	"question_en" text NOT NULL,
	"question_hi" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_indices" integer[] NOT NULL,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_quizzes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"shikshak_user_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completion_points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"city_id" uuid,
	"question_en" text NOT NULL,
	"question_hi" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_indices" integer[] NOT NULL,
	"difficulty" text,
	"age_groups" "age_group_enum"[],
	"topic" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"ai_generation_id" uuid,
	"reviewed" text,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quiz_event_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"score" integer,
	"correct_count" integer,
	"total_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_event_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quiz_event_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "quiz_scope_enum" NOT NULL,
	"city_id" uuid,
	"centre_id" uuid,
	"batch_id" uuid,
	"title_en" text NOT NULL,
	"title_hi" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"participation_points" integer DEFAULT 0 NOT NULL,
	"win_points" integer DEFAULT 0 NOT NULL,
	"target_age_groups" "age_group_enum"[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "service_request_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_user_id" uuid NOT NULL,
	"student_id" uuid,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"status" "service_request_status_enum" NOT NULL,
	"assigned_to_user_id" uuid,
	"centre_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"last_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_type" "library_content_type_enum" NOT NULL,
	"title_en" text NOT NULL,
	"title_hi" text NOT NULL,
	"description_en" text,
	"description_hi" text,
	"asset_id" uuid,
	"embed_url" text,
	"tags" text[],
	"age_groups" "age_group_enum"[],
	"languages" "language_enum"[],
	"access_tier" "library_access_tier_enum" NOT NULL,
	"msv_only" boolean DEFAULT false NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"city_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donation_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"target_amount_paise" bigint,
	"raised_amount_paise" bigint DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_public" boolean DEFAULT false NOT NULL,
	"progress_bar_visible" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donor_name" text NOT NULL,
	"donor_phone" varchar(15),
	"donor_email" varchar(255),
	"donor_pan" text,
	"amount_paise" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"purpose" "donation_purpose_enum" NOT NULL,
	"campaign_id" uuid,
	"frequency" "donation_frequency_enum" NOT NULL,
	"razorpay_order_id" text,
	"razorpay_payment_id" text,
	"razorpay_signature" text,
	"status" "payment_status_enum" DEFAULT 'created' NOT NULL,
	"payment_captured_at" timestamp with time zone,
	"eighty_g_eligible" boolean DEFAULT false NOT NULL,
	"receipt_number" text,
	"eighty_g_certificate_asset_id" uuid,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donor_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"email" varchar(255),
	"phone" varchar(15),
	"pan_hash" text,
	"total_donated_paise" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title_en" text NOT NULL,
	"title_hi" text NOT NULL,
	"body_en" text NOT NULL,
	"body_hi" text NOT NULL,
	"data" jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"channel" "notification_channel_enum" NOT NULL,
	"status" "notification_status_enum" DEFAULT 'pending' NOT NULL,
	"source_entity_kind" text,
	"source_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notice_id" uuid,
	"phone" varchar(15) NOT NULL,
	"body" text NOT NULL,
	"provider_message_id" text,
	"status" text,
	"cost_paise" integer,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"eighty_g_enabled" boolean DEFAULT false NOT NULL,
	"eighty_g_registration_number" text,
	"eighty_g_trust_name" text,
	"eighty_g_trust_address" text,
	"eighty_g_section" text DEFAULT '80G' NOT NULL,
	"last_updated_by" uuid,
	"last_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_singleton" CHECK ("platform_settings"."id" = 'global')
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"actor_role" "role_enum" NOT NULL,
	"action" "audit_action_enum" NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip" varchar(45),
	"user_agent" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_op_id" uuid NOT NULL,
	"op_kind" text NOT NULL,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"status" "sync_op_status_enum" NOT NULL,
	"error" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"period_kind" text NOT NULL,
	"period_label" text NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"pdf_asset_id" uuid,
	"shikshak_comment" text,
	"released_to_parent" boolean DEFAULT false NOT NULL,
	"released_at" timestamp with time zone,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"note" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_token_families" ADD CONSTRAINT "refresh_token_families_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_token_families" ADD CONSTRAINT "refresh_token_families_device_session_id_device_sessions_id_fk" FOREIGN KEY ("device_session_id") REFERENCES "public"."device_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_centre_id_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_shikshak_id_users_id_fk" FOREIGN KEY ("shikshak_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "centre_holidays" ADD CONSTRAINT "centre_holidays_centre_id_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "centre_holidays" ADD CONSTRAINT "centre_holidays_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "centres" ADD CONSTRAINT "centres_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "centres" ADD CONSTRAINT "centres_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "centres" ADD CONSTRAINT "centres_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanchalak_centre_assignments" ADD CONSTRAINT "sanchalak_centre_assignments_sanchalak_user_id_users_id_fk" FOREIGN KEY ("sanchalak_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanchalak_centre_assignments" ADD CONSTRAINT "sanchalak_centre_assignments_centre_id_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shikshak_batch_assignments" ADD CONSTRAINT "shikshak_batch_assignments_shikshak_user_id_users_id_fk" FOREIGN KEY ("shikshak_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shikshak_batch_assignments" ADD CONSTRAINT "shikshak_batch_assignments_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_id_cards" ADD CONSTRAINT "digital_id_cards_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_requested_centre_id_centres_id_fk" FOREIGN KEY ("requested_centre_id") REFERENCES "public"."centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_requested_batch_id_batches_id_fk" FOREIGN KEY ("requested_batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msv_enrolments" ADD CONSTRAINT "msv_enrolments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msv_enrolments" ADD CONSTRAINT "msv_enrolments_recommending_shikshak_id_users_id_fk" FOREIGN KEY ("recommending_shikshak_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msv_enrolments" ADD CONSTRAINT "msv_enrolments_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msv_enrolments" ADD CONSTRAINT "msv_enrolments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msv_enrolments" ADD CONSTRAINT "msv_enrolments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_centre_id_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_form_configs" ADD CONSTRAINT "registration_form_configs_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_form_configs" ADD CONSTRAINT "registration_form_configs_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_form_configs" ADD CONSTRAINT "registration_form_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_form_configs" ADD CONSTRAINT "registration_form_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_form_responses" ADD CONSTRAINT "registration_form_responses_form_config_id_registration_form_configs_id_fk" FOREIGN KEY ("form_config_id") REFERENCES "public"."registration_form_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_form_responses" ADD CONSTRAINT "registration_form_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_notifications" ADD CONSTRAINT "absence_notifications_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_notifications" ADD CONSTRAINT "absence_notifications_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_notifications" ADD CONSTRAINT "absence_notifications_expected_session_id_sessions_id_fk" FOREIGN KEY ("expected_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_cancellations" ADD CONSTRAINT "session_cancellations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_cancellations" ADD CONSTRAINT "session_cancellations_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_shikshak_user_id_users_id_fk" FOREIGN KEY ("shikshak_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_cancellation_by_users_id_fk" FOREIGN KEY ("cancellation_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punya_balances" ADD CONSTRAINT "punya_balances_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punya_configs" ADD CONSTRAINT "punya_configs_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punya_configs" ADD CONSTRAINT "punya_configs_feature_id_punya_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."punya_features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punya_features" ADD CONSTRAINT "punya_features_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punya_features" ADD CONSTRAINT "punya_features_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punya_transactions" ADD CONSTRAINT "punya_transactions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punya_transactions" ADD CONSTRAINT "punya_transactions_awarded_by_user_id_users_id_fk" FOREIGN KEY ("awarded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punya_transactions" ADD CONSTRAINT "punya_transactions_reversal_of_punya_transactions_id_fk" FOREIGN KEY ("reversal_of") REFERENCES "public"."punya_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punya_transactions" ADD CONSTRAINT "punya_transactions_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punya_transactions" ADD CONSTRAINT "punya_transactions_centre_id_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centres"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punya_transactions" ADD CONSTRAINT "punya_transactions_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niyam_streaks" ADD CONSTRAINT "niyam_streaks_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niyam_streaks" ADD CONSTRAINT "niyam_streaks_niyam_id_niyams_id_fk" FOREIGN KEY ("niyam_id") REFERENCES "public"."niyams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niyam_submissions" ADD CONSTRAINT "niyam_submissions_niyam_id_niyams_id_fk" FOREIGN KEY ("niyam_id") REFERENCES "public"."niyams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niyam_submissions" ADD CONSTRAINT "niyam_submissions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niyam_submissions" ADD CONSTRAINT "niyam_submissions_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niyam_submissions" ADD CONSTRAINT "niyam_submissions_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niyam_submissions" ADD CONSTRAINT "niyam_submissions_punya_transaction_id_punya_transactions_id_fk" FOREIGN KEY ("punya_transaction_id") REFERENCES "public"."punya_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niyam_submissions" ADD CONSTRAINT "niyam_submissions_reversal_transaction_id_punya_transactions_id_fk" FOREIGN KEY ("reversal_transaction_id") REFERENCES "public"."punya_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niyams" ADD CONSTRAINT "niyams_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niyams" ADD CONSTRAINT "niyams_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_niyam_submission_id_niyam_submissions_id_fk" FOREIGN KEY ("niyam_submission_id") REFERENCES "public"."niyam_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_centre_id_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_niyam_id_niyams_id_fk" FOREIGN KEY ("niyam_id") REFERENCES "public"."niyams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_assignments" ADD CONSTRAINT "homework_assignments_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_assignments" ADD CONSTRAINT "homework_assignments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_assignment_id_homework_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."homework_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_marked_by_user_id_users_id_fk" FOREIGN KEY ("marked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_punya_transaction_id_punya_transactions_id_fk" FOREIGN KEY ("punya_transaction_id") REFERENCES "public"."punya_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_notice_id_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_centre_id_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centres"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shivir_attendance_scans" ADD CONSTRAINT "shivir_attendance_scans_shivir_event_id_shivir_events_id_fk" FOREIGN KEY ("shivir_event_id") REFERENCES "public"."shivir_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shivir_attendance_scans" ADD CONSTRAINT "shivir_attendance_scans_shivir_session_id_shivir_sessions_id_fk" FOREIGN KEY ("shivir_session_id") REFERENCES "public"."shivir_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shivir_attendance_scans" ADD CONSTRAINT "shivir_attendance_scans_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shivir_attendance_scans" ADD CONSTRAINT "shivir_attendance_scans_volunteer_user_id_users_id_fk" FOREIGN KEY ("volunteer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shivir_events" ADD CONSTRAINT "shivir_events_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shivir_events" ADD CONSTRAINT "shivir_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shivir_events" ADD CONSTRAINT "shivir_events_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shivir_registrations" ADD CONSTRAINT "shivir_registrations_shivir_event_id_shivir_events_id_fk" FOREIGN KEY ("shivir_event_id") REFERENCES "public"."shivir_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shivir_registrations" ADD CONSTRAINT "shivir_registrations_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shivir_registrations" ADD CONSTRAINT "shivir_registrations_registered_by_user_id_users_id_fk" FOREIGN KEY ("registered_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shivir_sessions" ADD CONSTRAINT "shivir_sessions_shivir_event_id_shivir_events_id_fk" FOREIGN KEY ("shivir_event_id") REFERENCES "public"."shivir_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shivir_volunteers" ADD CONSTRAINT "shivir_volunteers_shivir_event_id_shivir_events_id_fk" FOREIGN KEY ("shivir_event_id") REFERENCES "public"."shivir_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shivir_volunteers" ADD CONSTRAINT "shivir_volunteers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shivir_volunteers" ADD CONSTRAINT "shivir_volunteers_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_registrations" ADD CONSTRAINT "competition_registrations_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_registrations" ADD CONSTRAINT "competition_registrations_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_registrations" ADD CONSTRAINT "competition_registrations_punya_transaction_id_punya_transactions_id_fk" FOREIGN KEY ("punya_transaction_id") REFERENCES "public"."punya_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_template_id_curriculum_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."curriculum_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_assignments" ADD CONSTRAINT "curriculum_assignments_curriculum_id_curricula_id_fk" FOREIGN KEY ("curriculum_id") REFERENCES "public"."curricula"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_assignments" ADD CONSTRAINT "curriculum_assignments_centre_id_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_assignments" ADD CONSTRAINT "curriculum_assignments_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_items" ADD CONSTRAINT "curriculum_items_section_id_curriculum_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."curriculum_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_sections" ADD CONSTRAINT "curriculum_sections_curriculum_id_curricula_id_fk" FOREIGN KEY ("curriculum_id") REFERENCES "public"."curricula"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_templates" ADD CONSTRAINT "curriculum_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_curriculum_progress" ADD CONSTRAINT "student_curriculum_progress_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_curriculum_progress" ADD CONSTRAINT "student_curriculum_progress_curriculum_item_id_curriculum_items_id_fk" FOREIGN KEY ("curriculum_item_id") REFERENCES "public"."curriculum_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_curriculum_progress" ADD CONSTRAINT "student_curriculum_progress_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_answers" ADD CONSTRAINT "exam_answers_attempt_id_exam_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."exam_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_answers" ADD CONSTRAINT "exam_answers_question_id_exam_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."exam_questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_answers" ADD CONSTRAINT "exam_answers_graded_by_user_id_users_id_fk" FOREIGN KEY ("graded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_exam_id_online_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."online_exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question_options" ADD CONSTRAINT "exam_question_options_question_id_exam_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."exam_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_exam_id_online_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."online_exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_exams" ADD CONSTRAINT "online_exams_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_exams" ADD CONSTRAINT "online_exams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_exams" ADD CONSTRAINT "online_exams_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_quiz_attempts" ADD CONSTRAINT "push_quiz_attempts_push_quiz_id_push_quizzes_id_fk" FOREIGN KEY ("push_quiz_id") REFERENCES "public"."push_quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_quiz_attempts" ADD CONSTRAINT "push_quiz_attempts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_quiz_questions" ADD CONSTRAINT "push_quiz_questions_push_quiz_id_push_quizzes_id_fk" FOREIGN KEY ("push_quiz_id") REFERENCES "public"."push_quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_quizzes" ADD CONSTRAINT "push_quizzes_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_quizzes" ADD CONSTRAINT "push_quizzes_shikshak_user_id_users_id_fk" FOREIGN KEY ("shikshak_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_quiz_event_id_quiz_events_id_fk" FOREIGN KEY ("quiz_event_id") REFERENCES "public"."quiz_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_event_questions" ADD CONSTRAINT "quiz_event_questions_quiz_event_id_quiz_events_id_fk" FOREIGN KEY ("quiz_event_id") REFERENCES "public"."quiz_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_event_questions" ADD CONSTRAINT "quiz_event_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_events" ADD CONSTRAINT "quiz_events_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_events" ADD CONSTRAINT "quiz_events_centre_id_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_events" ADD CONSTRAINT "quiz_events_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_events" ADD CONSTRAINT "quiz_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_events" ADD CONSTRAINT "quiz_events_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_messages" ADD CONSTRAINT "service_request_messages_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_messages" ADD CONSTRAINT "service_request_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_centre_id_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_access_logs" ADD CONSTRAINT "library_access_logs_item_id_library_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."library_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_access_logs" ADD CONSTRAINT "library_access_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_campaigns" ADD CONSTRAINT "donation_campaigns_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_campaign_id_donation_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."donation_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_profiles" ADD CONSTRAINT "donor_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD CONSTRAINT "sms_logs_notice_id_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_last_updated_by_users_id_fk" FOREIGN KEY ("last_updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_reports" ADD CONSTRAINT "progress_reports_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_tokens_token_unique" ON "device_tokens" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_unique" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "digital_id_cards_student_unique" ON "digital_id_cards" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_student_code_unique" ON "students" USING btree ("student_code");--> statement-breakpoint
CREATE UNIQUE INDEX "registration_form_configs_version_unique" ON "registration_form_configs" USING btree ("city_id","form_kind","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_session_student_unique" ON "attendance" USING btree ("session_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_client_op_unique" ON "attendance" USING btree ("client_op_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_snapshots_period_unique" ON "leaderboard_snapshots" USING btree ("scope","scope_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "punya_configs_city_feature_unique" ON "punya_configs" USING btree ("city_id","feature_id");--> statement-breakpoint
CREATE UNIQUE INDEX "punya_features_key_unique" ON "punya_features" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "punya_transactions_idempotency_key_unique" ON "punya_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "niyam_streaks_student_niyam_unique" ON "niyam_streaks" USING btree ("student_id","niyam_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_items_submission_unique" ON "gallery_items" USING btree ("niyam_submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "homework_submissions_assignment_student_unique" ON "homework_submissions" USING btree ("assignment_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notice_reads_notice_user_unique" ON "notice_reads" USING btree ("notice_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shivir_attendance_scans_client_op_unique" ON "shivir_attendance_scans" USING btree ("client_op_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shivir_registrations_event_student_unique" ON "shivir_registrations" USING btree ("shivir_event_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shivir_sessions_event_day_unique" ON "shivir_sessions" USING btree ("shivir_event_id","day_number");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_registrations_unique" ON "competition_registrations" USING btree ("competition_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_curriculum_progress_unique" ON "student_curriculum_progress" USING btree ("student_id","curriculum_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_operations_user_op_unique" ON "sync_operations" USING btree ("user_id","client_op_id");--> statement-breakpoint
CREATE UNIQUE INDEX "progress_reports_period_unique" ON "progress_reports" USING btree ("student_id","period_kind","period_label");