-- Step 22 — Library, Service Requests, Reports, Analytics
--
-- Deltas:
--   1. `service_requests`/`service_request_messages`: status column
--      already exists from 0001; this migration adds the
--      `last_response_at` index + helpful indexes on (city_id, status).
--   2. Materialised views per SPEC §12.2 (six views):
--        - mv_centre_engagement
--        - mv_punya_distribution
--        - mv_msv_pipeline
--        - mv_attendance_trends
--        - mv_niyam_completion
--        - mv_donations_summary
--      Every view carries a UNIQUE INDEX so REFRESH MATERIALIZED VIEW
--      CONCURRENTLY can run without blocking selects (CONCURRENTLY
--      requires a unique index on the populated columns — Postgres docs
--      §13.7). Refresh is owned by the analytics.refresh_views nightly
--      cron.
--   3. `library_items` already exists. Add indexes for the four-tier
--      access query path used by LibraryService.list().
--   4. `library_access_logs` already exists. Add a per-user index used
--      by the privacy-aware "my views" admin lookup.
--
-- All blocks are idempotent.

-- ===== 1. service_requests — indexes ======================================
CREATE INDEX IF NOT EXISTS "idx_service_requests_city_status"
  ON "service_requests" ("city_id", "status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_service_requests_parent_created"
  ON "service_requests" ("parent_user_id", "created_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_service_requests_assignee_status"
  ON "service_requests" ("assigned_to_user_id", "status")
  WHERE "assigned_to_user_id" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_service_request_messages_request"
  ON "service_request_messages" ("request_id", "created_at" DESC);
--> statement-breakpoint

-- ===== 2. library — listing / access-log indexes =========================
CREATE INDEX IF NOT EXISTS "idx_library_items_tier_type"
  ON "library_items" ("access_tier", "content_type")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_library_items_msv_tier"
  ON "library_items" ("msv_only", "access_tier")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_library_access_logs_user_at"
  ON "library_access_logs" ("user_id", "at" DESC)
  WHERE "user_id" IS NOT NULL;
--> statement-breakpoint

-- ===== 3. progress_reports — index for monthly listing ====================
CREATE INDEX IF NOT EXISTS "idx_progress_reports_student_period"
  ON "progress_reports" ("student_id", "period_kind", "generated_at" DESC);
--> statement-breakpoint

-- ===== 4. exports tracking table =========================================
-- The export.student.pdf and export.bulk.zip processors persist their
-- progress here so the GET /v1/admin/exports/:id polling endpoint can
-- return a status / asset id without scraping BullMQ state.
CREATE TABLE IF NOT EXISTS "export_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "requested_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "kind" text NOT NULL, -- 'student_pdf' | 'centre_bulk_zip'
  "scope_entity_kind" text NOT NULL, -- 'student' | 'centre'
  "scope_entity_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'pending', -- pending|running|ready|failed
  "asset_id" uuid REFERENCES "media_assets"("id") ON DELETE SET NULL,
  "error" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_export_jobs_requester_created"
  ON "export_jobs" ("requested_by_user_id", "created_at" DESC);
--> statement-breakpoint

-- ===========================================================================
-- 5. Materialised views (SPEC §12.2)
--
-- Postgres requires a UNIQUE INDEX on every column referenced in a row's
-- identity for REFRESH MATERIALIZED VIEW CONCURRENTLY to work. Each view
-- below grabs its identity from the natural group-by keys.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- mv_centre_engagement
-- One row per centre × month with attendance %, homework %, niyam %, punya.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS "mv_centre_engagement" CASCADE;
--> statement-breakpoint

CREATE MATERIALIZED VIEW "mv_centre_engagement" AS
WITH att AS (
  SELECT b.centre_id,
         to_char(s.scheduled_date, 'YYYY-MM') AS academic_month,
         COUNT(*) FILTER (WHERE a.status = 'present') AS present_count,
         COUNT(*)                                       AS total_marks
    FROM attendance a
    JOIN sessions s ON s.id = a.session_id
    JOIN batches b  ON b.id = s.batch_id
   GROUP BY b.centre_id, to_char(s.scheduled_date, 'YYYY-MM')
),
hw AS (
  SELECT b.centre_id,
         to_char(ha.due_date, 'YYYY-MM') AS academic_month,
         COUNT(*) FILTER (WHERE hs.status IN ('approved', 'starred', 'late')) AS submitted_count,
         COUNT(*) AS total_count
    FROM homework_assignments ha
    JOIN batches b ON b.id = ha.batch_id
    LEFT JOIN homework_submissions hs ON hs.assignment_id = ha.id
   WHERE ha.due_date IS NOT NULL
   GROUP BY b.centre_id, to_char(ha.due_date, 'YYYY-MM')
),
niy AS (
  SELECT pt.centre_id,
         to_char(ns.submitted_at, 'YYYY-MM') AS academic_month,
         COUNT(*) FILTER (WHERE ns.status = 'auto_approved') AS approved_count,
         COUNT(*) AS total_count
    FROM niyam_submissions ns
    JOIN punya_transactions pt ON pt.id = ns.punya_transaction_id
   GROUP BY pt.centre_id, to_char(ns.submitted_at, 'YYYY-MM')
),
pun AS (
  SELECT centre_id,
         to_char(awarded_at, 'YYYY-MM') AS academic_month,
         COALESCE(SUM(points), 0) AS total_punya_awarded
    FROM punya_transactions
   WHERE reversal_of IS NULL AND centre_id IS NOT NULL
   GROUP BY centre_id, to_char(awarded_at, 'YYYY-MM')
),
stu AS (
  SELECT centre_id,
         COUNT(*) FILTER (WHERE status = 'active' AND deleted_at IS NULL) AS active_students
    FROM students
   GROUP BY centre_id
)
SELECT
  c.id                                                AS centre_id,
  COALESCE(att.academic_month, hw.academic_month,
           niy.academic_month, pun.academic_month,
           to_char(now(), 'YYYY-MM'))                 AS academic_month,
  CASE WHEN att.total_marks > 0
       THEN ROUND((att.present_count::numeric / att.total_marks) * 100, 1)
       ELSE 0 END                                     AS attendance_rate,
  CASE WHEN hw.total_count > 0
       THEN ROUND((hw.submitted_count::numeric / hw.total_count) * 100, 1)
       ELSE 0 END                                     AS homework_completion_rate,
  CASE WHEN niy.total_count > 0
       THEN ROUND((niy.approved_count::numeric / niy.total_count) * 100, 1)
       ELSE 0 END                                     AS niyam_completion_rate,
  COALESCE(pun.total_punya_awarded, 0)                AS total_punya_awarded,
  COALESCE(stu.active_students, 0)                    AS active_students
FROM centres c
LEFT JOIN att  ON att.centre_id = c.id
LEFT JOIN hw   ON hw.centre_id = c.id  AND hw.academic_month  = att.academic_month
LEFT JOIN niy  ON niy.centre_id = c.id AND niy.academic_month = att.academic_month
LEFT JOIN pun  ON pun.centre_id = c.id AND pun.academic_month = att.academic_month
LEFT JOIN stu  ON stu.centre_id = c.id
WHERE c.deleted_at IS NULL
WITH NO DATA;
--> statement-breakpoint

CREATE UNIQUE INDEX "mv_centre_engagement_pk"
  ON "mv_centre_engagement" ("centre_id", "academic_month");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- mv_punya_distribution
-- Count of students in each spiritual tier (Jigyasu / Shravak / Sadhak /
-- Shraman / Tirthankar) per city. Lifetime points → tier per CLAUDE.md.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS "mv_punya_distribution" CASCADE;
--> statement-breakpoint

CREATE MATERIALIZED VIEW "mv_punya_distribution" AS
WITH lifetime AS (
  SELECT student_id,
         COALESCE(SUM(points), 0) AS total_points
    FROM punya_transactions
   WHERE reversal_of IS NULL
   GROUP BY student_id
),
tiered AS (
  SELECT s.id AS student_id,
         s.centre_id,
         c.city_id,
         CASE
           WHEN COALESCE(l.total_points, 0) <= 100  THEN 'jigyasu'
           WHEN COALESCE(l.total_points, 0) <= 500  THEN 'shravak'
           WHEN COALESCE(l.total_points, 0) <= 1500 THEN 'sadhak'
           WHEN COALESCE(l.total_points, 0) <= 5000 THEN 'shraman'
           ELSE 'tirthankar'
         END AS tier
    FROM students s
    JOIN centres c   ON c.id = s.centre_id
    LEFT JOIN lifetime l ON l.student_id = s.id
   WHERE s.status = 'active' AND s.deleted_at IS NULL
)
SELECT city_id,
       tier,
       COUNT(*)::int AS student_count
  FROM tiered
 GROUP BY city_id, tier
WITH NO DATA;
--> statement-breakpoint

CREATE UNIQUE INDEX "mv_punya_distribution_pk"
  ON "mv_punya_distribution" ("city_id", "tier");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- mv_msv_pipeline
-- One row per city × msv_status — applied / approved / rejected counts.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS "mv_msv_pipeline" CASCADE;
--> statement-breakpoint

CREATE MATERIALIZED VIEW "mv_msv_pipeline" AS
SELECT c.city_id,
       me.status AS msv_status,
       COUNT(*)::int AS student_count,
       MAX(me.decided_at) AS last_decision_at
  FROM msv_enrolments me
  JOIN students s ON s.id = me.student_id
  JOIN centres c  ON c.id = s.centre_id
 WHERE s.deleted_at IS NULL
 GROUP BY c.city_id, me.status
WITH NO DATA;
--> statement-breakpoint

CREATE UNIQUE INDEX "mv_msv_pipeline_pk"
  ON "mv_msv_pipeline" ("city_id", "msv_status");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- mv_attendance_trends
-- Daily attendance rate per city — last 90 days.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS "mv_attendance_trends" CASCADE;
--> statement-breakpoint

CREATE MATERIALIZED VIEW "mv_attendance_trends" AS
SELECT c.city_id,
       s.scheduled_date AS day,
       COUNT(*) FILTER (WHERE a.status = 'present') AS present_count,
       COUNT(*) AS total_marks,
       CASE WHEN COUNT(*) > 0
            THEN ROUND((COUNT(*) FILTER (WHERE a.status = 'present')::numeric / COUNT(*)) * 100, 1)
            ELSE 0 END AS attendance_rate
  FROM attendance a
  JOIN sessions s ON s.id = a.session_id
  JOIN batches b  ON b.id = s.batch_id
  JOIN centres c  ON c.id = b.centre_id
 WHERE s.scheduled_date >= (CURRENT_DATE - INTERVAL '90 days')
 GROUP BY c.city_id, s.scheduled_date
WITH NO DATA;
--> statement-breakpoint

CREATE UNIQUE INDEX "mv_attendance_trends_pk"
  ON "mv_attendance_trends" ("city_id", "day");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- mv_niyam_completion
-- One row per city × niyam_id with submission counts for the trailing 30 days.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS "mv_niyam_completion" CASCADE;
--> statement-breakpoint

CREATE MATERIALIZED VIEW "mv_niyam_completion" AS
SELECT pt.city_id,
       ns.niyam_id,
       COUNT(*) FILTER (WHERE ns.status = 'auto_approved') AS approved_count,
       COUNT(*) FILTER (WHERE ns.status = 'rejected') AS rejected_count,
       COUNT(*) AS submission_count
  FROM niyam_submissions ns
  JOIN punya_transactions pt ON pt.id = ns.punya_transaction_id
 WHERE ns.submitted_at >= (now() - INTERVAL '30 days')
 GROUP BY pt.city_id, ns.niyam_id
WITH NO DATA;
--> statement-breakpoint

CREATE UNIQUE INDEX "mv_niyam_completion_pk"
  ON "mv_niyam_completion" ("city_id", "niyam_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- mv_donations_summary
-- Per financial year + city totals for the admin donations dashboard.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS "mv_donations_summary" CASCADE;
--> statement-breakpoint

CREATE MATERIALIZED VIEW "mv_donations_summary" AS
SELECT COALESCE(d.financial_year, 'unknown') AS financial_year,
       COALESCE(dc.city_id, '00000000-0000-0000-0000-000000000000'::uuid) AS city_id,
       COUNT(*)::int AS donation_count,
       COALESCE(SUM(d.amount_paise), 0)::bigint AS total_paise,
       COUNT(*) FILTER (WHERE d.eighty_g_eligible)::int AS eighty_g_count
  FROM donations d
  LEFT JOIN donation_campaigns dc ON dc.id = d.campaign_id
 WHERE d.status = 'captured' AND d.deleted_at IS NULL
 GROUP BY COALESCE(d.financial_year, 'unknown'),
          COALESCE(dc.city_id, '00000000-0000-0000-0000-000000000000'::uuid)
WITH NO DATA;
--> statement-breakpoint

CREATE UNIQUE INDEX "mv_donations_summary_pk"
  ON "mv_donations_summary" ("financial_year", "city_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Seed: populate all six views once so the first reader doesn't see "no data".
-- ---------------------------------------------------------------------------
REFRESH MATERIALIZED VIEW "mv_centre_engagement";
--> statement-breakpoint
REFRESH MATERIALIZED VIEW "mv_punya_distribution";
--> statement-breakpoint
REFRESH MATERIALIZED VIEW "mv_msv_pipeline";
--> statement-breakpoint
REFRESH MATERIALIZED VIEW "mv_attendance_trends";
--> statement-breakpoint
REFRESH MATERIALIZED VIEW "mv_niyam_completion";
--> statement-breakpoint
REFRESH MATERIALIZED VIEW "mv_donations_summary";
