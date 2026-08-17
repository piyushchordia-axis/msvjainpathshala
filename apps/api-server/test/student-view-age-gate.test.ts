/**
 * Q4 student-view age gate boundary (MIN_STUDENT_VIEW_AGE, lowered 13 → 8).
 *
 * The gate had ZERO coverage before this file: nothing referenced the constant
 * or the refusal message, and none of the course suites ever logged in as a
 * `student`. These tests pin the boundary so the threshold cannot move silently,
 * and pin that a MISSING dob is reported as its own problem rather than as
 * "too young" — ~12% of students have no dob, and conflating the two sends
 * families arguing with the wrong thing.
 *
 * Exercises the shared service used by BOTH the online route
 * (POST /v1/courses/nodes/:nodeId/progress) and the offline sync path
 * (sync-batch course_progress), so a drift between them would fail here.
 */
import { describe, it, expect, afterAll } from "vitest";
import { pool, db, users, students } from "@workspace/db";
import { eq } from "drizzle-orm";
import { MIN_STUDENT_VIEW_AGE } from "@workspace/api-zod";
import { assertCourseProgressWriteAccess } from "../src/services/course-access";

const createdUserIds: string[] = [];
const createdStudentIds: string[] = [];

afterAll(async () => {
  for (const id of createdStudentIds) {
    await db.delete(students).where(eq(students.id, id)).catch(() => undefined);
  }
  for (const id of createdUserIds) {
    await db.delete(users).where(eq(users.id, id)).catch(() => undefined);
  }
  await pool.end();
});

/**
 * DOB for someone who turned `years` old `offsetDays` ago. A positive offset
 * clears the birthday (solidly that age); a negative offset leaves them a day
 * short. Avoids a flake when the suite runs on a fixture's exact birthday.
 */
function dobForAge(years: number, offsetDays: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() - offsetDays);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** A student-role user linked to their own active students row with `dob`. */
async function makeSelfManagingStudent(dob: string | null) {
  const phone = `+9197${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
  const [user] = await db
    .insert(users)
    .values({ phone, role: "student", full_name: "Age Gate Student", is_active: true })
    .returning();
  createdUserIds.push(user.id);

  const [student] = await db
    .insert(students)
    .values({
      student_code: `AGE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      full_name: "Age Gate Student",
      age_group: "bal",
      status: "active",
      user_id: user.id,
      dob,
    })
    .returning();
  createdStudentIds.push(student.id);

  return { user, student };
}

describe("Q4 student-view age gate", () => {
  it("is set to 8 — a student at the threshold may write their own progress", async () => {
    expect(MIN_STUDENT_VIEW_AGE).toBe(8);

    const { user, student } = await makeSelfManagingStudent(
      dobForAge(MIN_STUDENT_VIEW_AGE, 1),
    );
    const access = await assertCourseProgressWriteAccess(user, student.id);
    expect(access.ok).toBe(true);
  });

  it("refuses a student one day short of the threshold, and names the fix", async () => {
    const { user, student } = await makeSelfManagingStudent(
      dobForAge(MIN_STUDENT_VIEW_AGE, -1),
    );
    const access = await assertCourseProgressWriteAccess(user, student.id);
    expect(access.ok).toBe(false);
    if (access.ok) return;
    expect(access.code).toBe("ERR_FORBIDDEN");
    // Message is built from the constant, so it must carry the live value.
    expect(access.message).toContain(String(MIN_STUDENT_VIEW_AGE));
    // Error voice: state the problem AND the fix.
    expect(access.message).toContain("parent");
  });

  it("reports a missing date of birth as its own problem, not as 'too young'", async () => {
    const { user, student } = await makeSelfManagingStudent(null);
    const access = await assertCourseProgressWriteAccess(user, student.id);
    expect(access.ok).toBe(false);
    if (access.ok) return;
    expect(access.code).toBe("ERR_FORBIDDEN");
    expect(access.message).toContain("date of birth");
    expect(access.message).not.toContain("older");
  });

  it("still refuses a student acting on someone else's record, before any age check", async () => {
    // Ownership is checked first, so an age-eligible student cannot reach
    // another child's progress by being old enough.
    const mine = await makeSelfManagingStudent(dobForAge(15, 1));
    const other = await makeSelfManagingStudent(dobForAge(15, 1));
    const access = await assertCourseProgressWriteAccess(mine.user, other.student.id);
    expect(access.ok).toBe(false);
    if (access.ok) return;
    expect(access.code).toBe("ERR_COURSE_STUDENT_OUT_OF_SCOPE");
  });
});
