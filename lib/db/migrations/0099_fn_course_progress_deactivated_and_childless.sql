-- M1 + M2 — fn_course_progress (CU28), replaced in place.
--
-- M1 (Q11): the function never joined `students` at all, so a deactivated
-- student's progress kept moving in every reader (PDF worker, mobile, admin)
-- forever. AT5's canonical attendance formula excludes a deactivated
-- student's contribution from their deactivation forward while keeping prior
-- history — this mirrors that: a progress row counts only if it was last
-- touched (updated_at) BEFORE the student's deactivated_at. A student who was
-- never deactivated is unaffected.
--
-- M2 (CU16): the childless-section "roll-up is NULL, not 0 and not 100" rule
-- was patched only in the courses.ts caller (derived_status), and not at all
-- for derived_coverage/derived_mastery. CU28 itself still needs a childless
-- SECTION to act as its own leaf for a WHOLE-COURSE query (p_section_id IS
-- NULL) — a section-only course must report non-NULL progress — but that is
-- a different question from CU16's per-section roll-up ("did anyone touch
-- this section's own children"). The childless-section-as-its-own-leaf branch
-- now fires only when p_section_id IS NULL; a CU16 section-scoped call
-- (p_section_id set) against a section with zero live subsections now
-- returns leaf_total = 0, so coverage/mastery come back NULL from the
-- function itself, with no caller-side patch required.

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

    -- Sections with no live children are leaves (section-only courses) — but
    -- ONLY for a whole-course call. A CU16 section-scoped roll-up on a
    -- childless section must come back empty (leaf_total = 0), not treat the
    -- section as a stand-in leaf for itself (M2).
    SELECT
      cs.id AS section_id,
      cs.id AS leaf_id,
      'section'::text AS leaf_kind
    FROM course_sections cs
    WHERE cs.course_id = p_course_id
      AND cs.deleted_at IS NULL
      AND p_section_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM course_subsections sub
        WHERE sub.section_id = cs.id
          AND sub.deleted_at IS NULL
      )
  ),
  target_student AS (
    -- M1 / Q11 — joined once. A student row that doesn't exist (or a NULL
    -- deactivated_at) degrades to "count everything", same as before this
    -- change.
    SELECT s.deactivated_at
    FROM students s
    WHERE s.id = p_student_id
  ),
  leaf_progress AS (
    SELECT
      l.leaf_id,
      l.leaf_kind,
      p.status,
      p.certified_at
    FROM leaves l
    LEFT JOIN target_student t ON true
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
     -- M1 — excluded from deactivated_at forward; prior history retained.
     AND (t.deactivated_at IS NULL OR p.updated_at < t.deactivated_at)
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
    LEFT JOIN target_student t ON true
    LEFT JOIN student_course_progress p
      ON p.student_id = p_student_id
     AND p.section_id = s.id
     AND p.subsection_id IS NULL
     -- M1 — same exclusion applied to the declared section-status roll-up.
     AND (t.deactivated_at IS NULL OR p.updated_at < t.deactivated_at)
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
$$;--> statement-breakpoint
