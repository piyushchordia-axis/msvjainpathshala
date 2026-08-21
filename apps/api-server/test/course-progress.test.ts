/**
 * CU28 fn_course_progress + CU10 upsertCourseProgress exit criteria.
 *
 * Runs against whatever fn_course_progress the migration chain has actually
 * applied — it used to re-install 0052's SQL by hand in `beforeAll`, which
 * meant these tests silently passed against a function the migration chain
 * might never have shipped, AND clobbered any later CREATE OR REPLACE
 * (0099's M1/M2 fix) back to 0052's original body for the rest of this
 * file's run. Run the full migration chain (`node lib/db/scripts/migrate.mjs`)
 * before this suite, not a long-lived dev DB that may have drifted.
 */
import { describe, it, expect, afterAll } from "vitest";
import { pool } from "@workspace/db";
import { upsertCourseProgress } from "../src/services/course-progress";
import { ulid } from "../src/lib/ulid";

afterAll(async () => {
  await pool.end();
});

async function seedActor(): Promise<{ userId: string; studentId: string }> {
  const user = await pool.query<{ id: string }>(
    `select id from users where role = 'super_admin' order by created_at limit 1`,
  );
  const student = await pool.query<{ id: string }>(
    `select id from students where status = 'active' and deleted_at is null order by created_at limit 1`,
  );
  expect(user.rows[0]?.id).toBeTruthy();
  expect(student.rows[0]?.id).toBeTruthy();
  return { userId: user.rows[0]!.id, studentId: student.rows[0]!.id };
}

async function createCourse(name: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `insert into courses (name_en, name_hi, kind, status, academic_year, punya_points)
     values ($1, $2, 'standard', 'active', '2025-26', 0)
     returning id`,
    [name, "परीक्षण पाठ्यक्रम"],
  );
  return r.rows[0]!.id;
}

async function addSection(courseId: string, title: string, orderIndex: number): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `insert into course_sections (course_id, title_en, title_hi, order_index, punya_points)
     values ($1, $2, $3, $4, 10)
     returning id`,
    [courseId, title, title, orderIndex],
  );
  return r.rows[0]!.id;
}

async function addSubsection(sectionId: string, title: string, orderIndex: number): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `insert into course_subsections (section_id, title_en, title_hi, order_index)
     values ($1, $2, $3, $4)
     returning id`,
    [sectionId, title, title, orderIndex],
  );
  return r.rows[0]!.id;
}

async function progress(
  studentId: string,
  courseId: string,
  sectionId?: string | null,
): Promise<{
  leaf_total: number;
  leaf_reached: number;
  leaf_certified: number;
  section_total: number;
  section_certified: number;
  coverage: string | null;
  mastery: string | null;
}> {
  const r = await pool.query(
    `select * from fn_course_progress($1::uuid, $2::uuid, $3::uuid)`,
    [studentId, courseId, sectionId ?? null],
  );
  return r.rows[0] as {
    leaf_total: number;
    leaf_reached: number;
    leaf_certified: number;
    section_total: number;
    section_certified: number;
    coverage: string | null;
    mastery: string | null;
  };
}

describe("fn_course_progress (CU28)", () => {
  it("coverage is 0.35 for a student 7/20 through a course — not integer 0", async () => {
    const { userId, studentId } = await seedActor();
    const courseId = await createCourse(`CU28 7/20 ${Date.now()}`);

    // 4 sections × 5 subsections = 20 leaves
    const subsectionIds: string[] = [];
    for (let s = 0; s < 4; s++) {
      const sectionId = await addSection(courseId, `Sec ${s}`, s);
      for (let i = 0; i < 5; i++) {
        subsectionIds.push(await addSubsection(sectionId, `Item ${s}.${i}`, i));
      }
    }
    expect(subsectionIds.length).toBe(20);

    // Reach 7 leaves (in_progress or completed — not not_started).
    for (let i = 0; i < 7; i++) {
      await upsertCourseProgress({
        studentId,
        nodeKind: "subsection",
        nodeId: subsectionIds[i]!,
        status: i % 2 === 0 ? "in_progress" : "completed",
        updatedBy: userId,
        updatedByRole: "super_admin",
      });
    }

    const row = await progress(studentId, courseId);
    expect(row.leaf_total).toBe(20);
    expect(row.leaf_reached).toBe(7);
    expect(Number(row.coverage)).toBeCloseTo(0.35, 10);
    // Integer division would have produced 0 — this is the CU28 landmine.
    expect(Number(row.coverage)).not.toBe(0);
  });

  it("zero progress rows → coverage = 0 and mastery IS NULL", async () => {
    const { studentId } = await seedActor();
    const courseId = await createCourse(`CU28 empty ${Date.now()}`);
    const sectionId = await addSection(courseId, "Only section", 0);
    await addSubsection(sectionId, "A", 0);
    await addSubsection(sectionId, "B", 1);

    const row = await progress(studentId, courseId);
    expect(row.leaf_total).toBe(2);
    expect(row.leaf_reached).toBe(0);
    expect(Number(row.coverage)).toBe(0);
    expect(row.mastery).toBeNull();
  });

  it("section-only course fully certified → coverage = 1", async () => {
    const { userId, studentId } = await seedActor();
    const courseId = await createCourse(`CU28 section-only ${Date.now()}`);
    const s1 = await addSection(courseId, "S1", 0);
    const s2 = await addSection(courseId, "S2", 1);
    // No subsections — sections are the leaves.

    for (const sectionId of [s1, s2]) {
      await upsertCourseProgress({
        studentId,
        nodeKind: "section",
        nodeId: sectionId,
        status: "completed",
        updatedBy: userId,
        updatedByRole: "super_admin",
      });
      await pool.query(
        `update student_course_progress
            set certified_at = now(), certified_by = $1
          where student_id = $2 and section_id = $3 and subsection_id is null`,
        [userId, studentId, sectionId],
      );
    }

    const row = await progress(studentId, courseId);
    expect(row.leaf_total).toBe(2);
    expect(row.leaf_reached).toBe(2);
    expect(row.leaf_certified).toBe(2);
    expect(Number(row.coverage)).toBe(1);
    expect(Number(row.mastery)).toBe(1);
    expect(row.section_total).toBe(2);
    expect(row.section_certified).toBe(2);
  });

  it("certified sections AND subsections do not push mastery above 1", async () => {
    const { userId, studentId } = await seedActor();
    const courseId = await createCourse(`CU28 mastery cap ${Date.now()}`);
    const sectionId = await addSection(courseId, "Mixed", 0);
    const sub1 = await addSubsection(sectionId, "Leaf A", 0);
    const sub2 = await addSubsection(sectionId, "Leaf B", 1);

    // Certify both subsection leaves AND the parent section (section is NOT a leaf here).
    for (const nodeId of [sub1, sub2]) {
      await upsertCourseProgress({
        studentId,
        nodeKind: "subsection",
        nodeId,
        status: "completed",
        updatedBy: userId,
        updatedByRole: "super_admin",
      });
      await pool.query(
        `update student_course_progress
            set certified_at = now(), certified_by = $1
          where student_id = $2 and subsection_id = $3`,
        [userId, studentId, nodeId],
      );
    }
    await upsertCourseProgress({
      studentId,
      nodeKind: "section",
      nodeId: sectionId,
      status: "completed",
      updatedBy: userId,
      updatedByRole: "super_admin",
    });
    await pool.query(
      `update student_course_progress
          set certified_at = now(), certified_by = $1
        where student_id = $2 and section_id = $3 and subsection_id is null`,
      [userId, studentId, sectionId],
    );

    const row = await progress(studentId, courseId);
    // Leaves are the two subsections only — certified section must not inflate mastery.
    expect(row.leaf_total).toBe(2);
    expect(row.leaf_certified).toBe(2);
    expect(Number(row.mastery)).toBeLessThanOrEqual(1);
    expect(Number(row.mastery)).toBeCloseTo(1, 10);
    expect(row.section_certified).toBe(1);
  });
});

describe("upsertCourseProgress (CU10)", () => {
  it("concurrent writers on the same (student, node) leave one row and no error", async () => {
    const { userId, studentId } = await seedActor();
    const courseId = await createCourse(`CU10 race ${Date.now()}`);
    const sectionId = await addSection(courseId, "Race", 0);
    const nodeId = await addSubsection(sectionId, "Contested", 0);

    const results = await Promise.all([
      upsertCourseProgress({
        studentId,
        nodeKind: "subsection",
        nodeId,
        status: "in_progress",
        note: "writer-a",
        updatedBy: userId,
        updatedByRole: "super_admin",
      }),
      upsertCourseProgress({
        studentId,
        nodeKind: "subsection",
        nodeId,
        status: "completed",
        note: "writer-b",
        updatedBy: userId,
        updatedByRole: "shikshak",
      }),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBeTruthy();
    expect(results[1]!.id).toBeTruthy();
    // Same physical row (partial unique on student+subsection).
    expect(results[0]!.id).toBe(results[1]!.id);

    const count = await pool.query<{ n: string }>(
      `select count(*)::text as n from student_course_progress
        where student_id = $1 and subsection_id = $2`,
      [studentId, nodeId],
    );
    expect(Number(count.rows[0]!.n)).toBe(1);
  });

  it("a repeated client_op_id on a DIFFERENT node returns applied:false, not a 500 (M20)", async () => {
    const { userId, studentId } = await seedActor();
    const courseId = await createCourse(`M20 ${Date.now()}`);
    const sectionId = await addSection(courseId, "Sec", 0);
    const nodeA = await addSubsection(sectionId, "A", 0);
    const nodeB = await addSubsection(sectionId, "B", 1);

    const clientOpId = ulid();
    const first = await upsertCourseProgress({
      studentId,
      nodeKind: "subsection",
      nodeId: nodeA,
      status: "in_progress",
      clientOpId,
      updatedBy: userId,
      updatedByRole: "super_admin",
    });
    expect(first.applied).toBe(true);

    // Same client_op_id, but a genuinely different (student, node) row — this
    // is not a conflict on the ON CONFLICT target, so it must not 500.
    const second = await upsertCourseProgress({
      studentId,
      nodeKind: "subsection",
      nodeId: nodeB,
      status: "in_progress",
      clientOpId,
      updatedBy: userId,
      updatedByRole: "super_admin",
    });
    expect(second.applied).toBe(false);
    expect(second.subsection_id).toBe(nodeA);

    const rowB = await pool.query<{ n: string }>(
      `select count(*)::text as n from student_course_progress
        where student_id = $1 and subsection_id = $2`,
      [studentId, nodeB],
    );
    expect(rowB.rows[0]!.n).toBe("0");
  });
});

/**
 * DB-level constraint tests (block 6 / CU12's "the CHECK is the net" — the
 * service guard is the contract, but the net itself must actually hold).
 */
describe("student_course_progress constraints (DB-level)", () => {
  it("a second raw INSERT for the same (student_id, section_id) is rejected — 23505", async () => {
    const { studentId } = await seedActor();
    const courseId = await createCourse(`constraint dup ${Date.now()}`);
    const sectionId = await addSection(courseId, "Dup section", 0);

    await pool.query(
      `insert into student_course_progress
         (student_id, section_id, status, updated_by_role)
       values ($1, $2, 'in_progress', 'super_admin')`,
      [studentId, sectionId],
    );

    await expect(
      pool.query(
        `insert into student_course_progress
           (student_id, section_id, status, updated_by_role)
         values ($1, $2, 'in_progress', 'super_admin')`,
        [studentId, sectionId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("certified_at on a non-'completed' row raises 23514", async () => {
    const { userId, studentId } = await seedActor();
    const courseId = await createCourse(`constraint certified ${Date.now()}`);
    const sectionId = await addSection(courseId, "Certified-guard section", 0);
    const nodeId = await addSubsection(sectionId, "Guarded leaf", 0);

    await expect(
      pool.query(
        `insert into student_course_progress
           (student_id, subsection_id, status, certified_at, certified_by, updated_by_role)
         values ($1, $2, 'in_progress', now(), $3, 'super_admin')`,
        [studentId, nodeId, userId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("a malformed client_op_id is rejected — 23514", async () => {
    const { studentId } = await seedActor();
    const courseId = await createCourse(`constraint client_op_id ${Date.now()}`);
    const sectionId = await addSection(courseId, "Op-id-guard section", 0);
    const nodeId = await addSubsection(sectionId, "Guarded leaf 2", 0);

    await expect(
      pool.query(
        `insert into student_course_progress
           (student_id, subsection_id, status, client_op_id, updated_by_role)
         values ($1, $2, 'in_progress', 'not-a-valid-ulid', 'super_admin')`,
        [studentId, nodeId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("fn_course_progress excludes soft-deleted nodes and deactivated students (M1/M2, CU28/Q11)", () => {
  it("a soft-deleted subsection drops out of leaf_total", async () => {
    const { studentId } = await seedActor();
    const courseId = await createCourse(`soft-delete leaf ${Date.now()}`);
    const sectionId = await addSection(courseId, "Section", 0);
    await addSubsection(sectionId, "Keep", 0);
    const drop = await addSubsection(sectionId, "Drop", 1);

    const before = await progress(studentId, courseId);
    expect(before.leaf_total).toBe(2);

    await pool.query(`update course_subsections set deleted_at = now() where id = $1`, [drop]);

    const after = await progress(studentId, courseId);
    expect(after.leaf_total).toBe(1);
  });

  it("a deactivated student's progress stops counting from deactivation forward; prior history is retained (Q11) — fails against the pre-0099 function", async () => {
    const courseId = await createCourse(`deactivated student ${Date.now()}`);
    const sectionId = await addSection(courseId, "Section", 0);
    const nodeId = await addSubsection(sectionId, "Leaf", 0);

    const { userId } = await seedActor();
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const student = await pool.query<{ id: string }>(
      `insert into students (full_name, student_code, age_group, status)
       values ('M1 Test Student', $1, 'kishor', 'active')
       returning id`,
      [`M1${tag}`.slice(0, 24)],
    );
    const studentId = student.rows[0]!.id;

    try {
      // Certified two hours ago, while active.
      await pool.query(
        `insert into student_course_progress
           (student_id, subsection_id, status, certified_at, certified_by, updated_by_role, updated_at)
         values ($1, $2, 'completed', now() - interval '2 hours', $3, 'super_admin', now() - interval '2 hours')`,
        [studentId, nodeId, userId],
      );

      const whileActive = await progress(studentId, courseId);
      expect(whileActive.leaf_reached).toBe(1);
      expect(whileActive.leaf_certified).toBe(1);

      // Deactivated one hour ago — AFTER the progress row's updated_at (2h
      // ago), so that prior history is retained.
      await pool.query(
        `update students set status = 'inactive', deactivated_at = now() - interval '1 hour'
          where id = $1`,
        [studentId],
      );
      const retained = await progress(studentId, courseId);
      expect(retained.leaf_reached).toBe(1);
      expect(retained.leaf_certified).toBe(1);

      // The row is now touched AGAIN, after deactivation — this must stop
      // counting. The OLD function (pre-0099) never joined `students` at all
      // and would still report 1/1 here.
      await pool.query(
        `update student_course_progress set updated_at = now()
          where student_id = $1 and subsection_id = $2`,
        [studentId, nodeId],
      );
      const afterTouch = await progress(studentId, courseId);
      expect(afterTouch.leaf_reached).toBe(0);
      expect(afterTouch.leaf_certified).toBe(0);
      expect(Number(afterTouch.mastery ?? 0)).toBeFalsy();
    } finally {
      await pool.query(`delete from student_course_progress where student_id = $1`, [studentId]);
      await pool.query(`delete from students where id = $1`, [studentId]);
    }
  });
});
