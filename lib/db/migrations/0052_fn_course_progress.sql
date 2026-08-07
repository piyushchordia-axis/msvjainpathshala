-- CU28: ONE canonical course progress calculation (AT5 pattern).
-- Leaf nodes = non-deleted subsections PLUS non-deleted sections with zero
-- non-deleted subsections. LEFT JOIN progress (CU15). ::numeric cast on
-- numerators. COUNT(*) FILTER only. mastery NULL when leaf_reached = 0.
-- p_section_id scopes the same function for CU16 section roll-up — never a
-- second formula.

CREATE OR REPLACE FUNCTION fn_course_progress(
  p_student_id uuid,
  p_course_id uuid,
  p_section_id uuid DEFAULT NULL
)
RETURNS TABLE (
  leaf_total int,
  leaf_reached int,
  leaf_certified int,
  section_total int,
  section_certified int,
  coverage numeric,
  mastery numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH leaves AS (
    -- Subsections are always leaves.
    SELECT
      cs.id AS section_id,
      sub.id AS leaf_id,
      'subsection'::text AS leaf_kind
    FROM course_subsections sub
    INNER JOIN course_sections cs ON cs.id = sub.section_id
    WHERE cs.course_id = p_course_id
      AND cs.deleted_at IS NULL
      AND sub.deleted_at IS NULL
      AND (p_section_id IS NULL OR cs.id = p_section_id)

    UNION ALL

    -- Sections with no live children are leaves (section-only courses).
    SELECT
      cs.id AS section_id,
      cs.id AS leaf_id,
      'section'::text AS leaf_kind
    FROM course_sections cs
    WHERE cs.course_id = p_course_id
      AND cs.deleted_at IS NULL
      AND (p_section_id IS NULL OR cs.id = p_section_id)
      AND NOT EXISTS (
        SELECT 1
        FROM course_subsections sub
        WHERE sub.section_id = cs.id
          AND sub.deleted_at IS NULL
      )
  ),
  leaf_progress AS (
    SELECT
      l.leaf_id,
      l.leaf_kind,
      p.status,
      p.certified_at
    FROM leaves l
    LEFT JOIN student_course_progress p
      ON p.student_id = p_student_id
     AND (
       (l.leaf_kind = 'subsection' AND p.subsection_id = l.leaf_id)
       OR (
         l.leaf_kind = 'section'
         AND p.section_id = l.leaf_id
         AND p.subsection_id IS NULL
       )
     )
  ),
  section_rows AS (
    SELECT cs.id
    FROM course_sections cs
    WHERE cs.course_id = p_course_id
      AND cs.deleted_at IS NULL
      AND (p_section_id IS NULL OR cs.id = p_section_id)
  ),
  section_progress AS (
    SELECT
      s.id,
      p.certified_at
    FROM section_rows s
    LEFT JOIN student_course_progress p
      ON p.student_id = p_student_id
     AND p.section_id = s.id
     AND p.subsection_id IS NULL
  )
  SELECT
    (SELECT COUNT(*)::int FROM leaf_progress) AS leaf_total,
    (
      SELECT COUNT(*) FILTER (
        WHERE lp.status IS NOT NULL AND lp.status <> 'not_started'
      )::int
      FROM leaf_progress lp
    ) AS leaf_reached,
    (
      SELECT COUNT(*) FILTER (WHERE lp.certified_at IS NOT NULL)::int
      FROM leaf_progress lp
    ) AS leaf_certified,
    (SELECT COUNT(*)::int FROM section_rows) AS section_total,
    (
      SELECT COUNT(*) FILTER (WHERE sp.certified_at IS NOT NULL)::int
      FROM section_progress sp
    ) AS section_certified,
    (
      SELECT
        COUNT(*) FILTER (
          WHERE lp.status IS NOT NULL AND lp.status <> 'not_started'
        )::numeric
        / NULLIF(COUNT(*), 0)
      FROM leaf_progress lp
    ) AS coverage,
    (
      SELECT
        COUNT(*) FILTER (WHERE lp.certified_at IS NOT NULL)::numeric
        / NULLIF(
          COUNT(*) FILTER (
            WHERE lp.status IS NOT NULL AND lp.status <> 'not_started'
          ),
          0
        )
      FROM leaf_progress lp
    ) AS mastery;
$$;
