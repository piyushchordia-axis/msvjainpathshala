/**
 * 0017 derived-attendance fix:
 * - percentage values identical with/without the dead holiday clause
 * - EXPLAIN ANALYZE timings for old CROSS JOIN MVs vs new grouped MVs
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, stopHarness, type Harness } from "./harness";

const OLD_PCT_FN = `
CREATE OR REPLACE FUNCTION attendance_percentage(
  p_student_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT (
    COUNT(*) FILTER (WHERE a.status IN ('present', 'late'))::numeric
    / NULLIF(COUNT(*) FILTER (WHERE a.status IN ('present', 'late', 'absent')), 0)
  )
  FROM attendance a
  INNER JOIN sessions s ON s.id = a.session_id
  INNER JOIN batches b ON b.id = s.batch_id
  INNER JOIN students st ON st.id = a.student_id
  WHERE a.student_id = p_student_id
    AND s.status <> 'cancelled'
    AND (
      NOT EXISTS (
        SELECT 1 FROM centre_holidays h
        WHERE h.centre_id = b.centre_id AND h.holiday_date = s.scheduled_date
      )
      OR EXISTS (SELECT 1 FROM attendance ax WHERE ax.session_id = s.id)
    )
    AND (
      st.deactivated_at IS NULL
      OR s.scheduled_date < ((st.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date)
    )
    AND (p_from IS NULL OR s.scheduled_date >= p_from)
    AND (p_to IS NULL OR s.scheduled_date <= p_to);
$$`;

const NEW_PCT_FN = `
CREATE OR REPLACE FUNCTION attendance_percentage(
  p_student_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT (
    COUNT(*) FILTER (WHERE a.status IN ('present', 'late'))::numeric
    / NULLIF(COUNT(*) FILTER (WHERE a.status IN ('present', 'late', 'absent')), 0)
  )
  FROM attendance a
  INNER JOIN sessions s ON s.id = a.session_id
  INNER JOIN batches b ON b.id = s.batch_id
  INNER JOIN students st ON st.id = a.student_id
  WHERE a.student_id = p_student_id
    AND s.status <> 'cancelled'
    AND (
      st.deactivated_at IS NULL
      OR s.scheduled_date < ((st.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date)
    )
    AND (p_from IS NULL OR s.scheduled_date >= p_from)
    AND (p_to IS NULL OR s.scheduled_date <= p_to);
$$`;

const OLD_CENTRE_MV = `
DROP MATERIALIZED VIEW IF EXISTS mv_centre_engagement CASCADE;
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
  FROM sessions s WHERE s.scheduled_date IS NOT NULL
) m
WHERE c.deleted_at IS NULL
WITH NO DATA;
CREATE UNIQUE INDEX mv_centre_engagement_uq ON mv_centre_engagement (centre_id, month);
`;

const NEW_CENTRE_MV = `
DROP MATERIALIZED VIEW IF EXISTS mv_centre_engagement CASCADE;
CREATE MATERIALIZED VIEW mv_centre_engagement AS
SELECT
  c.id AS centre_id,
  c.city_id,
  date_trunc('month', s.scheduled_date::timestamp)::date AS month,
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
WITH NO DATA;
CREATE UNIQUE INDEX mv_centre_engagement_uq ON mv_centre_engagement (centre_id, month);
`;

describe("0017 derived attendance fix", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  }, 180_000);

  afterAll(async () => {
    await stopHarness();
  });

  it("attendance_percentage values are identical before/after removing the dead holiday clause", async () => {
    const client = await h.pool.connect();
    try {
      const { centreId, batchId, studentIds, sessionId } = h.fixtures;
      const focus = studentIds[0]!;

      await client.query(`delete from attendance where session_id = $1`, [sessionId]);
      await client.query(
        `delete from centre_holidays where centre_id = $1 and holiday_date = '2026-03-10'`,
        [centreId],
      );
      await client.query(
        `insert into centre_holidays (centre_id, holiday_date, reason)
         values ($1, '2026-03-10', 'Holi')`,
        [centreId],
      );

      const hol = await client.query(
        `insert into sessions (batch_id, scheduled_date, status)
         values ($1, '2026-03-10', 'completed') returning id`,
        [batchId],
      );
      const holId = hol.rows[0].id as string;
      await client.query(
        `insert into attendance (session_id, student_id, status, session_date, revision)
         values ($1, $2, 'present', '2026-03-10', 1)`,
        [holId, focus],
      );
      await client.query(
        `insert into attendance (session_id, student_id, status, session_date, revision)
         values ($1, $2, 'present', '2026-03-15', 1)`,
        [sessionId, focus],
      );
      await client.query(
        `insert into attendance (session_id, student_id, status, session_date, revision)
         values ($1, $2, 'absent', '2026-03-15', 1)
         on conflict (session_id, student_id) do update set status = 'absent'`,
        // use a second student on fixture session as absent for centre-level noise
        [sessionId, studentIds[1]!],
      );
      // focus present on fixture session
      await client.query(
        `insert into attendance (session_id, student_id, status, session_date, revision)
         values ($1, $2, 'present', '2026-03-15', 1)
         on conflict (session_id, student_id) do update set status = 'present'`,
        [sessionId, focus],
      );

      await client.query(OLD_PCT_FN);
      const before = await client.query(
        `select attendance_percentage($1::uuid, '2026-03-01'::date, '2026-03-31'::date) as rate`,
        [focus],
      );

      await client.query(NEW_PCT_FN);
      const after = await client.query(
        `select attendance_percentage($1::uuid, '2026-03-01'::date, '2026-03-31'::date) as rate`,
        [focus],
      );

      expect(after.rows[0].rate).toEqual(before.rows[0].rate);
      expect(Number(after.rows[0].rate)).toBeCloseTo(1.0, 5);
    } finally {
      client.release();
    }
  });

  it("EXPLAIN ANALYZE: grouped MV refresh vs CROSS JOIN per-centre function calls", async () => {
    const client = await h.pool.connect();
    try {
      const { stateId, cityId } = await (async () => {
        const st = await client.query(`select id from states limit 1`);
        const stateId = st.rows[0].id as string;
        return { stateId, cityId: h.fixtures.cityId };
      })();

      // Scale: 40 centres × 12 months × 1 session × 5 marks ≈ enough for a visible gap.
      const centreIds: string[] = [h.fixtures.centreId];
      for (let i = 0; i < 39; i++) {
        const c = await client.query(
          `insert into centres (state_id, city_id, name, status, gps_radius_meters)
           values ($1, $2, $3, 'active', 250) returning id`,
          [stateId, cityId, `Explain Centre ${i}`],
        );
        const centreId = c.rows[0].id as string;
        centreIds.push(centreId);
        const b = await client.query(
          `insert into batches (centre_id, name, age_group, day_of_week, start_time, end_time, capacity, status)
           values ($1, 'B', 'bal', '{0}', '10:00', '11:00', 40, 'active') returning id`,
          [centreId],
        );
        const batchId = b.rows[0].id as string;
        for (let m = 1; m <= 12; m++) {
          const date = `2025-${String(m).padStart(2, "0")}-15`;
          const s = await client.query(
            `insert into sessions (batch_id, scheduled_date, status)
             values ($1, $2::date, 'completed') returning id`,
            [batchId, date],
          );
          const sessionId = s.rows[0].id as string;
          for (let k = 0; k < 5; k++) {
            const stu = await client.query(
              `insert into students (student_code, full_name, age_group, centre_id, batch_id, status)
               values ($1, $2, 'bal', $3, $4, 'active') returning id`,
              [`EX${i}-${m}-${k}`, `S ${i}-${m}-${k}`, centreId, batchId],
            );
            await client.query(
              `insert into attendance (session_id, student_id, status, session_date, revision)
               values ($1, $2, 'present', $3::date, 1)`,
              [sessionId, stu.rows[0].id, date],
            );
          }
        }
      }

      // REFRESH is a utility (no plan). EXPLAIN ANALYZE the defining SELECT instead,
      // and also wall-clock a full REFRESH for each shape.
      const oldSelect = `
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
          FROM sessions s WHERE s.scheduled_date IS NOT NULL
        ) m
        WHERE c.deleted_at IS NULL`;

      const newSelect = `
        SELECT
          c.id AS centre_id,
          c.city_id,
          date_trunc('month', s.scheduled_date::timestamp)::date AS month,
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
        GROUP BY c.id, c.city_id, date_trunc('month', s.scheduled_date::timestamp)::date`;

      const beforeExplain = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${oldSelect}`,
      );
      const beforeText = beforeExplain.rows.map((r: { "QUERY PLAN": string }) => r["QUERY PLAN"]).join("\n");
      const beforeMs = parseExecutionMs(beforeText);

      const afterExplain = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${newSelect}`,
      );
      const afterText = afterExplain.rows.map((r: { "QUERY PLAN": string }) => r["QUERY PLAN"]).join("\n");
      const afterMs = parseExecutionMs(afterText);

      await client.query(OLD_CENTRE_MV);
      const t0 = performance.now();
      await client.query(`REFRESH MATERIALIZED VIEW mv_centre_engagement`);
      const beforeRefreshMs = performance.now() - t0;

      await client.query(NEW_CENTRE_MV);
      const t1 = performance.now();
      await client.query(`REFRESH MATERIALIZED VIEW mv_centre_engagement`);
      const afterRefreshMs = performance.now() - t1;

      console.log("\n=== EXPLAIN ANALYZE mv_centre_engagement defining SELECT ===");
      console.log("--- BEFORE (CROSS JOIN + attendance_percentage_for_centres per row) ---");
      console.log(beforeText);
      console.log(`BEFORE Execution Time: ${beforeMs.toFixed(3)} ms`);
      console.log(`BEFORE REFRESH wall-clock: ${beforeRefreshMs.toFixed(3)} ms`);
      console.log("--- AFTER (single grouped aggregate) ---");
      console.log(afterText);
      console.log(`AFTER Execution Time: ${afterMs.toFixed(3)} ms`);
      console.log(`AFTER REFRESH wall-clock: ${afterRefreshMs.toFixed(3)} ms`);
      console.log(
        `Speedup (EXPLAIN): ${(beforeMs / Math.max(afterMs, 0.001)).toFixed(2)}x; ` +
          `REFRESH: ${(beforeRefreshMs / Math.max(afterRefreshMs, 0.001)).toFixed(2)}x\n`,
      );

      expect(afterMs).toBeLessThan(beforeMs);
      expect(afterRefreshMs).toBeLessThan(beforeRefreshMs);
      void centreIds;
    } finally {
      client.release();
    }
  }, 300_000);
});

function parseExecutionMs(plan: string): number {
  const m = /Execution Time:\s*([\d.]+)\s*ms/i.exec(plan);
  if (!m) throw new Error(`No Execution Time in plan:\n${plan}`);
  return Number(m[1]);
}
