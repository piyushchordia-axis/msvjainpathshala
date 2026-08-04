-- F4: canonical homework completion rate (AT5 pattern) + mv_centre_engagement column.
--
-- Definition of record (same arithmetic in both functions — never re-implement in TS):
--
--   homework_completion_rate =
--     COUNT(*) FILTER (WHERE status IN (
--       'submitted', 'late', 'acknowledged', 'approved', 'starred', 'returned'
--     ))
--     / NULLIF(COUNT(*) /* all in-scope submission rows */, 0)
--
-- Numerator: family acted — upload, mark-done, graded, or returned for rework
--            ('returned' counts: the work was done even if it came back).
-- Denominator: every homework_submissions row for assignments whose due_date
--              falls in [p_from, p_to] (inclusive), assignment not soft-deleted.
-- Exclusions: soft-deleted assignments; students from deactivated_at Kolkata
--             date forward (due_date < deactivated Kolkata date keeps prior work).
-- Empty set: NULL (no homework set ≠ 0% — AT6 silence is not absence).
-- Use COUNT(*) FILTER, never COUNT(boolean).

CREATE OR REPLACE FUNCTION homework_completion_rate(
  p_student_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
) RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT
    (
      COUNT(*) FILTER (
        WHERE hs.status IN (
          'submitted', 'late', 'acknowledged', 'approved', 'starred', 'returned'
        )
      )::numeric
      / NULLIF(COUNT(*) FILTER (WHERE hs.id IS NOT NULL), 0)
    )
  FROM homework_submissions hs
  INNER JOIN homework_assignments ha ON ha.id = hs.assignment_id
  INNER JOIN students st ON st.id = hs.student_id
  WHERE hs.student_id = p_student_id
    AND ha.deleted_at IS NULL
    AND (
      st.deactivated_at IS NULL
      OR ha.due_date < ((st.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date)
    )
    AND (p_from IS NULL OR ha.due_date >= p_from)
    AND (p_to IS NULL OR ha.due_date <= p_to);
$$;

CREATE OR REPLACE FUNCTION homework_completion_rate_for_centres(
  p_centre_ids uuid[] DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
) RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT
    (
      COUNT(*) FILTER (
        WHERE hs.status IN (
          'submitted', 'late', 'acknowledged', 'approved', 'starred', 'returned'
        )
      )::numeric
      / NULLIF(COUNT(*) FILTER (WHERE hs.id IS NOT NULL), 0)
    )
  FROM homework_submissions hs
  INNER JOIN homework_assignments ha ON ha.id = hs.assignment_id
  INNER JOIN batches b ON b.id = ha.batch_id
  INNER JOIN students st ON st.id = hs.student_id
  WHERE ha.deleted_at IS NULL
    AND (p_centre_ids IS NULL OR b.centre_id = ANY (p_centre_ids))
    AND (
      st.deactivated_at IS NULL
      OR ha.due_date < ((st.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date)
    )
    AND (p_from IS NULL OR ha.due_date >= p_from)
    AND (p_to IS NULL OR ha.due_date <= p_to);
$$;

-- Extend canonical engagement MV (do not invent a new view name).
DROP MATERIALIZED VIEW IF EXISTS mv_centre_engagement CASCADE;

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
  -- Definition of record: homework_completion_rate_for_centres()
  homework_completion_rate_for_centres(
    ARRAY[c.id]::uuid[],
    date_trunc('month', s.scheduled_date::timestamp)::date,
    (
      date_trunc('month', s.scheduled_date::timestamp)::date
      + INTERVAL '1 month'
      - INTERVAL '1 day'
    )::date
  ) AS homework_completion_rate,
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
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_centre_engagement_uq
  ON mv_centre_engagement (centre_id, month);
