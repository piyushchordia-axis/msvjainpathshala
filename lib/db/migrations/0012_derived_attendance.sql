-- AT5 / AT22 / AT27 / AT31 derived-data layer: canonical attendance_%, streaks support,
-- consecutive-absence notes, notification prefs, materialised views (canonical names only).

ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "deactivated_at" timestamptz;--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notification_preferences" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "student_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"author_user_id" uuid,
	"note_type" text NOT NULL DEFAULT 'general',
	"body_en" text NOT NULL,
	"body_hi" text,
	"metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_student_id_students_id_fk"
    FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_author_user_id_users_id_fk"
    FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_student_notes_student" ON "student_notes" USING btree ("student_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_student_notes_type" ON "student_notes" USING btree ("note_type");--> statement-breakpoint

-- Already-flagged guard for AT27: one open alert per (student, third absent session).
CREATE TABLE IF NOT EXISTS "consecutive_absence_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"end_session_id" uuid NOT NULL,
	"alerted_at" timestamptz DEFAULT now() NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "consecutive_absence_alerts" ADD CONSTRAINT "consecutive_absence_alerts_student_id_fk"
    FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "consecutive_absence_alerts" ADD CONSTRAINT "consecutive_absence_alerts_end_session_id_fk"
    FOREIGN KEY ("end_session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "consecutive_absence_alerts_student_end_uq"
  ON "consecutive_absence_alerts" USING btree ("student_id", "end_session_id");--> statement-breakpoint

-- AT5 — ONE canonical attendance percentage. Materialised views MUST call this.
-- Use COUNT(*) FILTER — never COUNT(boolean), which counts every non-null row.
CREATE OR REPLACE FUNCTION attendance_percentage(
  p_student_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
) RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT
    (
      COUNT(*) FILTER (WHERE a.status IN ('present', 'late'))::numeric
      / NULLIF(COUNT(*) FILTER (WHERE a.status IN ('present', 'late', 'absent')), 0)
    )
  FROM attendance a
  INNER JOIN sessions s ON s.id = a.session_id
  INNER JOIN batches b ON b.id = s.batch_id
  INNER JOIN students st ON st.id = a.student_id
  WHERE a.student_id = p_student_id
    AND s.status <> 'cancelled'
    -- AT10: holiday sessions that already have attendance are NOT retro-excluded.
    AND (
      NOT EXISTS (
        SELECT 1 FROM centre_holidays h
        WHERE h.centre_id = b.centre_id
          AND h.holiday_date = s.scheduled_date
      )
      OR EXISTS (SELECT 1 FROM attendance ax WHERE ax.session_id = s.id)
    )
    AND (
      st.deactivated_at IS NULL
      OR s.scheduled_date < ((st.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date)
    )
    AND (p_from IS NULL OR s.scheduled_date >= p_from)
    AND (p_to IS NULL OR s.scheduled_date <= p_to);
$$;--> statement-breakpoint

-- Scoped aggregate (admin dashboards / MVs) — same FILTER arithmetic as AT5.
CREATE OR REPLACE FUNCTION attendance_percentage_for_centres(
  p_centre_ids uuid[] DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
) RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT
    (
      COUNT(*) FILTER (WHERE a.status IN ('present', 'late'))::numeric
      / NULLIF(COUNT(*) FILTER (WHERE a.status IN ('present', 'late', 'absent')), 0)
    )
  FROM attendance a
  INNER JOIN sessions s ON s.id = a.session_id
  INNER JOIN batches b ON b.id = s.batch_id
  INNER JOIN students st ON st.id = a.student_id
  WHERE s.status <> 'cancelled'
    AND (p_centre_ids IS NULL OR b.centre_id = ANY (p_centre_ids))
    AND (
      NOT EXISTS (
        SELECT 1 FROM centre_holidays h
        WHERE h.centre_id = b.centre_id
          AND h.holiday_date = s.scheduled_date
      )
      OR EXISTS (SELECT 1 FROM attendance ax WHERE ax.session_id = s.id)
    )
    AND (
      st.deactivated_at IS NULL
      OR s.scheduled_date < ((st.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date)
    )
    AND (p_from IS NULL OR s.scheduled_date >= p_from)
    AND (p_to IS NULL OR s.scheduled_date <= p_to);
$$;--> statement-breakpoint

-- Convenience view for clients that prefer a joinable relation.
CREATE OR REPLACE VIEW v_student_attendance_rate AS
SELECT
  st.id AS student_id,
  attendance_percentage(st.id) AS attendance_rate
FROM students st;--> statement-breakpoint

-- Drop any non-canonical aliases if they ever existed.
DROP MATERIALIZED VIEW IF EXISTS mv_attendance_trends CASCADE;--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS mv_msv_pipeline CASCADE;--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS mv_donations_summary CASCADE;--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS mv_donation_summary CASCADE;--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS mv_msv_funnel CASCADE;--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS mv_centre_engagement CASCADE;--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS mv_city_attendance_monthly CASCADE;--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS mv_punya_distribution CASCADE;--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS mv_niyam_completion CASCADE;--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS mv_monthly_leaderboard_city CASCADE;--> statement-breakpoint

CREATE MATERIALIZED VIEW mv_centre_engagement AS
SELECT
  c.id AS centre_id,
  c.city_id,
  m.month,
  attendance_percentage_for_centres(
    ARRAY[c.id]::uuid[],
    m.month,
    (m.month + INTERVAL '1 month' - INTERVAL '1 day')::date
  ) AS attendance_rate,
  (
    SELECT COUNT(*)::int FROM students st
    WHERE st.centre_id = c.id AND st.status = 'active' AND st.deleted_at IS NULL
  ) AS active_students
FROM centres c
CROSS JOIN (
  SELECT DISTINCT date_trunc('month', s.scheduled_date::timestamp)::date AS month
  FROM sessions s
  WHERE s.scheduled_date IS NOT NULL
) m
WHERE c.deleted_at IS NULL
WITH NO DATA;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mv_centre_engagement_uq
  ON mv_centre_engagement (centre_id, month);--> statement-breakpoint

CREATE MATERIALIZED VIEW mv_city_attendance_monthly AS
SELECT
  ci.id AS city_id,
  m.month,
  attendance_percentage_for_centres(
    ARRAY(SELECT c2.id FROM centres c2 WHERE c2.city_id = ci.id AND c2.deleted_at IS NULL),
    m.month,
    (m.month + INTERVAL '1 month' - INTERVAL '1 day')::date
  ) AS attendance_rate
FROM cities ci
CROSS JOIN (
  SELECT DISTINCT date_trunc('month', s.scheduled_date::timestamp)::date AS month
  FROM sessions s
  WHERE s.scheduled_date IS NOT NULL
) m
WITH NO DATA;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mv_city_attendance_monthly_uq
  ON mv_city_attendance_monthly (city_id, month);--> statement-breakpoint

CREATE MATERIALIZED VIEW mv_donation_summary AS
SELECT
  COALESCE(dc.city_id, '00000000-0000-0000-0000-000000000000'::uuid) AS city_id,
  date_trunc('month', COALESCE(d.payment_captured_at, d.created_at))::date AS month,
  COUNT(*) FILTER (WHERE d.payment_status = 'captured') AS donation_count,
  COALESCE(SUM(d.amount_paise) FILTER (WHERE d.payment_status = 'captured'), 0)::bigint AS total_paise
FROM donations d
LEFT JOIN donation_campaigns dc ON dc.id = d.campaign_id
GROUP BY 1, 2
WITH NO DATA;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mv_donation_summary_uq
  ON mv_donation_summary (city_id, month);--> statement-breakpoint

CREATE MATERIALIZED VIEW mv_msv_funnel AS
SELECT
  COALESCE(c.city_id, '00000000-0000-0000-0000-000000000000'::uuid) AS city_id,
  COUNT(*) FILTER (WHERE me.status = 'applied') AS applied,
  COUNT(*) FILTER (WHERE me.status = 'approved') AS approved,
  COUNT(*) FILTER (WHERE me.status = 'rejected') AS rejected,
  COUNT(*) FILTER (WHERE st.msv_status = 'approved') AS active_msv_students
FROM msv_enrolments me
INNER JOIN students st ON st.id = me.student_id
LEFT JOIN centres c ON c.id = st.centre_id
GROUP BY 1
WITH NO DATA;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mv_msv_funnel_uq
  ON mv_msv_funnel (city_id);--> statement-breakpoint

CREATE MATERIALIZED VIEW mv_punya_distribution AS
SELECT
  COALESCE(c.city_id, '00000000-0000-0000-0000-000000000000'::uuid) AS city_id,
  pb.tier,
  COUNT(*)::int AS student_count,
  COALESCE(SUM(pb.total_points), 0)::bigint AS total_points
FROM punya_balances pb
INNER JOIN students st ON st.id = pb.student_id AND st.deleted_at IS NULL
LEFT JOIN centres c ON c.id = st.centre_id
GROUP BY 1, pb.tier
WITH NO DATA;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mv_punya_distribution_uq
  ON mv_punya_distribution (city_id, tier);--> statement-breakpoint

CREATE MATERIALIZED VIEW mv_niyam_completion AS
SELECT
  COALESCE(c.city_id, '00000000-0000-0000-0000-000000000000'::uuid) AS city_id,
  date_trunc('month', ns.submission_date::timestamp)::date AS month,
  COUNT(*) FILTER (WHERE ns.status = 'approved') AS approved_count,
  COUNT(*) FILTER (WHERE ns.status = 'pending') AS pending_count,
  COUNT(*) FILTER (WHERE ns.status = 'rejected') AS rejected_count
FROM niyam_submissions ns
INNER JOIN students st ON st.id = ns.student_id
LEFT JOIN centres c ON c.id = st.centre_id
GROUP BY 1, date_trunc('month', ns.submission_date::timestamp)::date
WITH NO DATA;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mv_niyam_completion_uq
  ON mv_niyam_completion (city_id, month);--> statement-breakpoint

CREATE MATERIALIZED VIEW mv_monthly_leaderboard_city AS
SELECT
  COALESCE(c.city_id, '00000000-0000-0000-0000-000000000000'::uuid) AS city_id,
  date_trunc('month', timezone('Asia/Kolkata', now()))::date AS month,
  st.id AS student_id,
  st.full_name,
  pb.total_points,
  pb.tier,
  rank() OVER (
    PARTITION BY COALESCE(c.city_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY pb.total_points DESC, st.id
  ) AS rank
FROM punya_balances pb
INNER JOIN students st ON st.id = pb.student_id AND st.deleted_at IS NULL AND st.status = 'active'
LEFT JOIN centres c ON c.id = st.centre_id
WITH NO DATA;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mv_monthly_leaderboard_city_uq
  ON mv_monthly_leaderboard_city (city_id, month, student_id);--> statement-breakpoint

-- Seed streak feature (AT22 — 20 pts every 4 attended). Idempotent.
INSERT INTO punya_features ("key", "label", "min_points", "max_points", "is_active")
SELECT 'attendance_streak', 'Attendance streak bonus', 20, 20, true
WHERE NOT EXISTS (SELECT 1 FROM punya_features WHERE "key" = 'attendance_streak');--> statement-breakpoint

INSERT INTO punya_configs (feature_key, points, city_id, is_active)
SELECT 'attendance_streak', 20, NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM punya_configs WHERE feature_key = 'attendance_streak' AND city_id IS NULL
);
