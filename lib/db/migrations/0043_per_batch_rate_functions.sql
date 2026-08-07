-- AT5 canonical per-batch rate functions (set-returning).
-- Same bodies as attendance_percentage_for_centres / homework_completion_rate_for_centres
-- (0017 / 0026), with a single p_centre_id and GROUP BY b.id.
-- Mobile, admin panel, and the PDF worker must call these — never re-implement
-- the FILTER arithmetic in TypeScript (see CLAUDE.md AT5).

-- ---------------------------------------------------------------------------
-- attendance_rate_by_batch — AT5 canonical alongside attendance_percentage_for_centres
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION attendance_rate_by_batch(
  p_centre_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
) RETURNS TABLE (batch_id uuid, attendance_rate numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT
    b.id AS batch_id,
    (
      COUNT(*) FILTER (WHERE a.status IN ('present', 'late'))::numeric
      / NULLIF(COUNT(*) FILTER (WHERE a.status IN ('present', 'late', 'absent')), 0)
    ) AS attendance_rate
  FROM attendance a
  INNER JOIN sessions s ON s.id = a.session_id
  INNER JOIN batches b ON b.id = s.batch_id
  INNER JOIN students st ON st.id = a.student_id
  WHERE s.status <> 'cancelled'
    AND b.centre_id = p_centre_id
    -- No holiday filter: same rationale as attendance_percentage() (AT10 / 0017).
    AND (
      st.deactivated_at IS NULL
      OR s.scheduled_date < ((st.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date)
    )
    AND (p_from IS NULL OR s.scheduled_date >= p_from)
    AND (p_to IS NULL OR s.scheduled_date <= p_to)
  GROUP BY b.id;
$$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- homework_completion_rate_by_batch — AT5/F4 canonical alongside homework_completion_rate_for_centres
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION homework_completion_rate_by_batch(
  p_centre_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
) RETURNS TABLE (batch_id uuid, homework_rate numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT
    b.id AS batch_id,
    (
      COUNT(*) FILTER (
        WHERE hs.status IN (
          'submitted', 'late', 'acknowledged', 'approved', 'starred', 'returned'
        )
      )::numeric
      / NULLIF(COUNT(*) FILTER (WHERE hs.id IS NOT NULL), 0)
    ) AS homework_rate
  FROM homework_submissions hs
  INNER JOIN homework_assignments ha ON ha.id = hs.assignment_id
  INNER JOIN batches b ON b.id = ha.batch_id
  INNER JOIN students st ON st.id = hs.student_id
  WHERE ha.deleted_at IS NULL
    AND b.centre_id = p_centre_id
    AND (
      st.deactivated_at IS NULL
      OR ha.due_date < ((st.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date)
    )
    AND (p_from IS NULL OR ha.due_date >= p_from)
    AND (p_to IS NULL OR ha.due_date <= p_to)
  GROUP BY b.id;
$$;--> statement-breakpoint
