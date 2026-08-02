-- Follow-up to 0012_derived_attendance (do not edit 0012 — already applied):
--   1. Remove dead holiday predicate from attendance_percentage* (AT10 note only)
--   2. Rewrite mv_centre_engagement / mv_city_attendance_monthly as single grouped aggregates
--   3. Replace mv_monthly_leaderboard_city with monthly_leaderboard_snapshots TABLE

-- ---------------------------------------------------------------------------
-- 1. Canonical percentage functions — drop the always-true holiday OR EXISTS
-- ---------------------------------------------------------------------------
-- Both functions start FROM attendance a INNER JOIN sessions s, so
--   EXISTS (SELECT 1 FROM attendance ax WHERE ax.session_id = s.id)
-- is satisfied by row `a` itself and the whole
--   (NOT EXISTS holiday OR EXISTS attendance)
-- predicate is ALWAYS true. It never filtered anything.
--
-- That is also the correct AT10 behaviour: this function only ever sees sessions
-- that already have attendance rows, and holiday sessions that already have
-- marks must NOT be retro-excluded. No holiday filter is reachable or needed
-- here — do not re-add one.
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
    -- No holiday filter: see migration 0017 header / AT10. Function only sees
    -- sessions that already have attendance; holiday exclusion is a materialise concern.
    AND (
      st.deactivated_at IS NULL
      OR s.scheduled_date < ((st.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date)
    )
    AND (p_from IS NULL OR s.scheduled_date >= p_from)
    AND (p_to IS NULL OR s.scheduled_date <= p_to);
$$;--> statement-breakpoint

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
    -- No holiday filter: same rationale as attendance_percentage() (AT10 / 0017).
    AND (
      st.deactivated_at IS NULL
      OR s.scheduled_date < ((st.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date)
    )
    AND (p_from IS NULL OR s.scheduled_date >= p_from)
    AND (p_to IS NULL OR s.scheduled_date <= p_to);
$$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Engagement MVs — one grouped scan (FILTER arithmetic = attendance_percentage)
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_centre_engagement CASCADE;--> statement-breakpoint

CREATE MATERIALIZED VIEW mv_centre_engagement AS
SELECT
  c.id AS centre_id,
  c.city_id,
  date_trunc('month', s.scheduled_date::timestamp)::date AS month,
  -- Definition of record: attendance_percentage() / attendance_percentage_for_centres()
  (
    COUNT(*) FILTER (WHERE a.status IN ('present', 'late'))::numeric
    / NULLIF(COUNT(*) FILTER (WHERE a.status IN ('present', 'late', 'absent')), 0)
  ) AS attendance_rate,
  (
    SELECT COUNT(*)::int FROM students st2
    WHERE st2.centre_id = c.id AND st2.status = 'active' AND st2.deleted_at IS NULL
  ) AS active_students
FROM centres c
INNER JOIN batches b ON b.centre_id = c.id
INNER JOIN sessions s ON s.batch_id = b.id AND s.status <> 'cancelled'
INNER JOIN attendance a ON a.session_id = s.id
INNER JOIN students st ON st.id = a.student_id
WHERE c.deleted_at IS NULL
  AND (
    st.deactivated_at IS NULL
    OR s.scheduled_date < ((st.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date)
  )
GROUP BY c.id, c.city_id, date_trunc('month', s.scheduled_date::timestamp)::date
WITH NO DATA;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mv_centre_engagement_uq
  ON mv_centre_engagement (centre_id, month);--> statement-breakpoint

DROP MATERIALIZED VIEW IF EXISTS mv_city_attendance_monthly CASCADE;--> statement-breakpoint

CREATE MATERIALIZED VIEW mv_city_attendance_monthly AS
SELECT
  ci.id AS city_id,
  date_trunc('month', s.scheduled_date::timestamp)::date AS month,
  -- Definition of record: attendance_percentage() / attendance_percentage_for_centres()
  (
    COUNT(*) FILTER (WHERE a.status IN ('present', 'late'))::numeric
    / NULLIF(COUNT(*) FILTER (WHERE a.status IN ('present', 'late', 'absent')), 0)
  ) AS attendance_rate
FROM cities ci
INNER JOIN centres c ON c.city_id = ci.id AND c.deleted_at IS NULL
INNER JOIN batches b ON b.centre_id = c.id
INNER JOIN sessions s ON s.batch_id = b.id AND s.status <> 'cancelled'
INNER JOIN attendance a ON a.session_id = s.id
INNER JOIN students st ON st.id = a.student_id
WHERE (
    st.deactivated_at IS NULL
    OR s.scheduled_date < ((st.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date)
  )
GROUP BY ci.id, date_trunc('month', s.scheduled_date::timestamp)::date
WITH NO DATA;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mv_city_attendance_monthly_uq
  ON mv_city_attendance_monthly (city_id, month);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Monthly leaderboard — real TABLE (MV cannot preserve history)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "monthly_leaderboard_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "city_id" uuid NOT NULL,
  "month" date NOT NULL,
  "student_id" uuid NOT NULL,
  "full_name" text NOT NULL,
  "total_points" integer NOT NULL,
  "tier" "tier_enum" NOT NULL,
  "rank" integer NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "monthly_leaderboard_snapshots"
    ADD CONSTRAINT "monthly_leaderboard_snapshots_student_id_fk"
    FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- city_id has no FK: producers may use the nil-uuid sentinel when a student has no centre/city.
CREATE UNIQUE INDEX IF NOT EXISTS "monthly_leaderboard_snapshots_city_month_student_uq"
  ON "monthly_leaderboard_snapshots" ("city_id", "month", "student_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_monthly_leaderboard_snapshots_month"
  ON "monthly_leaderboard_snapshots" ("month");--> statement-breakpoint

-- Note: mv_monthly_leaderboard_city was often created WITH NO DATA (unpopulated),
-- so SELECT-copy is unsafe. History starts at the next snapshotMonthlyLeaderboard() run.
DROP MATERIALIZED VIEW IF EXISTS mv_monthly_leaderboard_city CASCADE;
