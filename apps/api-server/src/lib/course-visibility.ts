/**
 * CU3 — course visibility predicate (generalises msv.ts msvCurriculumByStudent).
 * MSV gate reads students.msv_status = 'approved', NOT msv_enrolments.
 */
import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import { centres, courses, students, db } from "@workspace/db";
import { MIN_STUDENT_VIEW_AGE, meetsStudentViewAge } from "@workspace/api-zod";

export type VisibilityStudent = {
  id: string;
  centre_id: string | null;
  msv_status: string | null;
};

/** City of the student's centre, or null when uncentred. */
export async function studentCityId(centreId: string | null): Promise<string | null> {
  if (!centreId) return null;
  const [row] = await db
    .select({ city_id: centres.city_id })
    .from(centres)
    .where(eq(centres.id, centreId))
    .limit(1);
  return row?.city_id ?? null;
}

/**
 * SQL fragment: courses visible to this student under CU3.
 * Caller still filters deleted_at / soft-delete as needed.
 */
export function courseVisibleToStudentSql(
  student: VisibilityStudent,
  cityId: string | null,
): SQL {
  const cityOk = cityId
    ? or(isNull(courses.city_id), eq(courses.city_id, cityId))
    : isNull(courses.city_id);

  // Non-approved students never see kind='msv' (CU3).
  const kindOk =
    student.msv_status === "approved" ? undefined : eq(courses.kind, "standard");

  return and(eq(courses.status, "active"), isNull(courses.deleted_at), cityOk, kindOk)!;
}

/** Load an active student row for visibility / scope checks. */
export async function loadActiveStudent(studentId: string): Promise<{
  id: string;
  centre_id: string | null;
  batch_id: string | null;
  parent_id: string | null;
  user_id: string | null;
  msv_status: string | null;
  dob: string | null;
  status: string;
} | null> {
  const [row] = await db
    .select({
      id: students.id,
      centre_id: students.centre_id,
      batch_id: students.batch_id,
      parent_id: students.parent_id,
      user_id: students.user_id,
      msv_status: students.msv_status,
      dob: students.dob,
      status: students.status,
    })
    .from(students)
    .where(and(eq(students.id, studentId), isNull(students.deleted_at)))
    .limit(1);
  return row ?? null;
}

/**
 * Q4 student-view age gate, shared by the online route and the offline sync
 * service so the two can never disagree or drift apart on the threshold.
 *
 * `meetsStudentViewAge` is false for BOTH a too-young child and a missing DOB,
 * and those need different messages: an under-age child is told their parent can
 * do it, while a child with no DOB on record is told what has to be fixed and by
 * whom. Reporting "too young" to a 14-year-old whose DOB was never captured
 * sends the family arguing with the wrong thing. Messages are built from
 * MIN_STUDENT_VIEW_AGE — never retype the number.
 */
export function studentViewAgeRefusal(dob: string | null): string | null {
  if (!dob) {
    return "Your date of birth is not on record, so we cannot confirm your age — ask your centre to add it, or your parent can update this for you.";
  }
  if (!meetsStudentViewAge(dob)) {
    return `Updating your own progress needs age ${MIN_STUDENT_VIEW_AGE} or older — your parent can update it for you.`;
  }
  return null;
}
