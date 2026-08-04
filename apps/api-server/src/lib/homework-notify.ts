/**
 * Parent notifications for homework assign / grade.
 * One notification per parent per assignment (not per child) — same restraint as AT31.
 * Prefs are gated inside notifyUsers (push / kind 'homework').
 */
import { db, students, homework_assignments } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { notifyUsers } from "./notify";
import { logger } from "./logger";

/** Unique parent user ids for the given students (skips null parent_id). */
export async function parentUserIdsForStudents(studentIds: string[]): Promise<string[]> {
  const ids = [...new Set(studentIds)].filter(Boolean);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ parent_id: students.parent_id })
    .from(students)
    .where(
      and(
        inArray(students.id, ids),
        eq(students.status, "active"),
        isNull(students.deleted_at),
      ),
    );
  return [...new Set(rows.map((r) => r.parent_id).filter((id): id is string => !!id))];
}

/** After assignment create — one inbox/push per parent across all target children. */
export async function notifyParentsHomeworkAssigned(opts: {
  studentIds: string[];
  assignmentTitle: string;
}): Promise<void> {
  try {
    const parentIds = await parentUserIdsForStudents(opts.studentIds);
    if (parentIds.length === 0) return;
    const title = opts.assignmentTitle.trim() || "Homework";
    await notifyUsers({
      userIds: parentIds,
      kind: "homework",
      title_en: "New homework",
      title_hi: "नया गृहकार्य",
      body_en: `Guruji assigned "${title}". Open Homework to view it.`,
      body_hi: `गुरुजी ने "${title}" दिया है। देखने के लिए गृहकार्य खोलें।`,
    });
  } catch (err) {
    logger.warn({ err }, "notifyParentsHomeworkAssigned failed");
  }
}

/** After a grade that awards or changes points — notify that student's parent. */
export async function notifyParentHomeworkGraded(opts: {
  studentId: string;
  status: "approved" | "starred";
  assignmentId?: string;
}): Promise<void> {
  try {
    const [stu] = await db
      .select({
        parent_id: students.parent_id,
        full_name: students.full_name,
      })
      .from(students)
      .where(eq(students.id, opts.studentId))
      .limit(1);
    if (!stu?.parent_id) return;

    let assignmentTitle = "homework";
    if (opts.assignmentId) {
      const [a] = await db
        .select({ title: homework_assignments.title })
        .from(homework_assignments)
        .where(eq(homework_assignments.id, opts.assignmentId))
        .limit(1);
      if (a?.title) assignmentTitle = a.title;
    }

    const shortName = (stu.full_name ?? "your child").trim().split(/\s+/)[0] || "your child";
    const starred = opts.status === "starred";

    await notifyUsers({
      userIds: [stu.parent_id],
      kind: "homework",
      title_en: starred ? "Homework starred" : "Homework approved",
      title_hi: starred ? "गृहकार्य विशेष" : "गृहकार्य स्वीकृत",
      body_en: starred
        ? `Guruji starred ${shortName}'s work on "${assignmentTitle}".`
        : `Guruji approved ${shortName}'s work on "${assignmentTitle}".`,
      body_hi: starred
        ? `गुरुजी ने ${shortName} के "${assignmentTitle}" कार्य को विशेष बनाया।`
        : `गुरुजी ने ${shortName} के "${assignmentTitle}" कार्य को स्वीकार किया।`,
    });
  } catch (err) {
    logger.warn({ err, studentId: opts.studentId }, "notifyParentHomeworkGraded failed");
  }
}

/** After Guruji returns work for rework — parent must act (F9). */
export async function notifyParentHomeworkReturned(opts: {
  studentId: string;
  assignmentId?: string;
  feedbackNote: string;
}): Promise<void> {
  try {
    const [stu] = await db
      .select({
        parent_id: students.parent_id,
        full_name: students.full_name,
      })
      .from(students)
      .where(eq(students.id, opts.studentId))
      .limit(1);
    if (!stu?.parent_id) return;

    let assignmentTitle = "homework";
    if (opts.assignmentId) {
      const [a] = await db
        .select({ title: homework_assignments.title })
        .from(homework_assignments)
        .where(eq(homework_assignments.id, opts.assignmentId))
        .limit(1);
      if (a?.title) assignmentTitle = a.title;
    }

    const shortName = (stu.full_name ?? "your child").trim().split(/\s+/)[0] || "your child";
    const note = opts.feedbackNote.trim().slice(0, 200);

    await notifyUsers({
      userIds: [stu.parent_id],
      kind: "homework",
      title_en: "Homework returned",
      title_hi: "गृहकार्य वापस",
      body_en: `Guruji returned ${shortName}'s work on "${assignmentTitle}" — please revise and resubmit. ${note}`,
      body_hi: `गुरुजी ने ${shortName} के "${assignmentTitle}" कार्य को वापस किया — कृपया सुधारकर पुनः प्रस्तुत करें। ${note}`,
    });
  } catch (err) {
    logger.warn({ err, studentId: opts.studentId }, "notifyParentHomeworkReturned failed");
  }
}
