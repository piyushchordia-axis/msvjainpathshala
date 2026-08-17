/**
 * Shared scope checks for online course routes and sync/batch handlers.
 */
import type { User } from "@workspace/db";
import { hasMinRole } from "../lib/roles";
import { resolveAdminScope, inBatchWriteScope } from "../lib/scope";
import { loadActiveStudent, studentViewAgeRefusal } from "../lib/course-visibility";

export type CourseAccessDenied = {
  ok: false;
  code: "ERR_COURSE_STUDENT_OUT_OF_SCOPE" | "ERR_FORBIDDEN";
  message: string;
};

export type CourseAccessOk = { ok: true };

/**
 * Parent / student self (Q4 age gate) / shikshak+ inBatchWriteScope — the same
 * rules as the online progress write, sharing one age-gate helper so the offline
 * path can never accept a mark the online path would refuse.
 */
export async function assertCourseProgressWriteAccess(
  actor: User,
  studentId: string,
): Promise<CourseAccessOk | CourseAccessDenied> {
  const stu = await loadActiveStudent(studentId);
  if (!stu || stu.status !== "active") {
    return {
      ok: false,
      code: "ERR_COURSE_STUDENT_OUT_OF_SCOPE",
      message: "That student is outside your scope.",
    };
  }

  if (actor.role === "parent") {
    if (stu.parent_id !== actor.id) {
      return {
        ok: false,
        code: "ERR_COURSE_STUDENT_OUT_OF_SCOPE",
        message: "That student is not your child — you cannot update their progress.",
      };
    }
    return { ok: true };
  }

  if (actor.role === "student") {
    if (stu.user_id !== actor.id) {
      return {
        ok: false,
        code: "ERR_COURSE_STUDENT_OUT_OF_SCOPE",
        message: "You can only update your own course progress.",
      };
    }
    const refusal = studentViewAgeRefusal(stu.dob);
    if (refusal) {
      return {
        ok: false,
        code: "ERR_FORBIDDEN",
        message: refusal,
      };
    }
    return { ok: true };
  }

  if (hasMinRole(actor.role, "shikshak")) {
    const scope = await resolveAdminScope(actor);
    if (!inBatchWriteScope(scope, stu.batch_id, stu.centre_id)) {
      return {
        ok: false,
        code: "ERR_COURSE_STUDENT_OUT_OF_SCOPE",
        message: "That student is outside your scope.",
      };
    }
    return { ok: true };
  }

  return {
    ok: false,
    code: "ERR_FORBIDDEN",
    message: "You do not have access to this resource.",
  };
}

/** CU21 — certification is batch-bound for shikshak+ only. */
export async function assertCourseCertifyAccess(
  actor: User,
  studentId: string,
): Promise<CourseAccessOk | CourseAccessDenied> {
  if (!hasMinRole(actor.role, "shikshak")) {
    return {
      ok: false,
      code: "ERR_FORBIDDEN",
      message: "Only Guruji or above can certify a course node.",
    };
  }
  const stu = await loadActiveStudent(studentId);
  if (!stu || stu.status !== "active") {
    return {
      ok: false,
      code: "ERR_COURSE_STUDENT_OUT_OF_SCOPE",
      message: "That student is outside your scope.",
    };
  }
  const scope = await resolveAdminScope(actor);
  if (!inBatchWriteScope(scope, stu.batch_id, stu.centre_id)) {
    return {
      ok: false,
      code: "ERR_COURSE_STUDENT_OUT_OF_SCOPE",
      message: "That student is outside your scope.",
    };
  }
  return { ok: true };
}
