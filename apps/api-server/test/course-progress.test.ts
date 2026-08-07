/**
 * CU28 fn_course_progress + CU10 upsertCourseProgress exit criteria.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { pool } from "@workspace/db";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { upsertCourseProgress } from "../src/services/course-progress";

const __dirname = dirname(fileURLToPath(import.meta.url));

afterAll(async () => {
  await pool.end();
});

beforeAll(async () => {
  const sql = readFileSync(
    join(__dirname, "../../../lib/db/migrations/0052_fn_course_progress.sql"),
    "utf8",
  );
  await pool.query(sql);
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
});
