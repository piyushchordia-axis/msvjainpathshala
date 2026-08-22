/**
 * Parent notifications for homework assign / grade.
 * One notification per parent per assignment (not per child) — same restraint as AT31.
 * Prefs are gated inside notifyUsers (push / kind 'homework').
 *
 * X-15 (review 2026-08, deferred) — neither notifyParentsHomeworkAssigned nor
 * notifyParentsHomeworkBulkGraded carries a dedupe key, so a retried request
 * re-fires them. The per-submission grade path (homework.ts's "noop"/
 * "metadata" result kinds) already skips re-notifying on a truly identical
 * re-grade; these two do not have an equivalent natural checkpoint. A real
 * fix needs a claim column (mirroring shivir-notify's `announced_at`) on
 * homework_assignments — that is a schema change intentionally left out of
 * this pass rather than bolted on without the same scrutiny AT16-style
 * idempotency gets elsewhere in this codebase.
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

/**
 * Parent AND the student's own (Q4, 8+) user ids for the given active
 * students — X-16 (review 2026-08). A parent_id-only send left a student who
 * has their own OTP login hearing nothing about their own homework.
 */
async function recipientUserIdsForStudents(
  studentIds: string[],
): Promise<{ userIds: string[]; byStudent: Map<string, string[]> }> {
  const ids = [...new Set(studentIds)].filter(Boolean);
  if (ids.length === 0) return { userIds: [], byStudent: new Map() };
  const rows = await db
    .select({ id: students.id, parent_id: students.parent_id, user_id: students.user_id })
    .from(students)
    .where(and(inArray(students.id, ids), eq(students.status, "active"), isNull(students.deleted_at)));

  const all = new Set<string>();
  const byStudent = new Map<string, string[]>();
  for (const r of rows) {
    const recipients = [r.parent_id, r.user_id].filter((id): id is string => !!id);
    byStudent.set(r.id, recipients);
    for (const id of recipients) all.add(id);
  }
  return { userIds: [...all], byStudent };
}

/** After assignment create — one inbox/push per recipient across all target children. */
export async function notifyParentsHomeworkAssigned(opts: {
  studentIds: string[];
  assignmentTitle: string;
  assignmentId: string;
}): Promise<void> {
  try {
    const { userIds } = await recipientUserIdsForStudents(opts.studentIds);
    if (userIds.length === 0) return;
    const title = opts.assignmentTitle.trim() || "Homework";
    await notifyUsers({
      userIds,
      kind: "homework",
      title_en: "New homework",
      title_hi: "नया गृहकार्य",
      body_en: `Guruji assigned "${title}". Open Homework to view it.`,
      body_hi: `गुरुजी ने "${title}" दिया है। देखने के लिए गृहकार्य खोलें।`,
      data: {
        kind: "homework",
        assignment_id: opts.assignmentId,
        route: `/homework-assignment/${opts.assignmentId}`,
      },
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
    // X-27 (review 2026-08) — filter to active, non-deleted, matching the
    // batch helper (parentUserIdsForStudents) which already did this.
    const [stu] = await db
      .select({
        parent_id: students.parent_id,
        user_id: students.user_id,
        full_name: students.full_name,
      })
      .from(students)
      .where(and(eq(students.id, opts.studentId), eq(students.status, "active"), isNull(students.deleted_at)))
      .limit(1);
    // X-16 — dual audience: parent AND the student's own Q4 login, deduped.
    const userIds = [...new Set([stu?.parent_id, stu?.user_id].filter((id): id is string => !!id))];
    if (userIds.length === 0) return;

    let assignmentTitle = "homework";
    if (opts.assignmentId) {
      const [a] = await db
        .select({ title: homework_assignments.title })
        .from(homework_assignments)
        .where(eq(homework_assignments.id, opts.assignmentId))
        .limit(1);
      if (a?.title) assignmentTitle = a.title;
    }

    const shortName = (stu?.full_name ?? "your child").trim().split(/\s+/)[0] || "your child";
    const starred = opts.status === "starred";
    const route = opts.assignmentId ? `/homework-assignment/${opts.assignmentId}` : undefined;

    await notifyUsers({
      userIds,
      kind: "homework",
      title_en: starred ? "Homework starred" : "Homework approved",
      title_hi: starred ? "गृहकार्य विशेष" : "गृहकार्य स्वीकृत",
      body_en: starred
        ? `Guruji starred ${shortName}'s work on "${assignmentTitle}".`
        : `Guruji approved ${shortName}'s work on "${assignmentTitle}".`,
      body_hi: starred
        ? `गुरुजी ने ${shortName} के "${assignmentTitle}" कार्य को विशेष बनाया।`
        : `गुरुजी ने ${shortName} के "${assignmentTitle}" कार्य को स्वीकार किया।`,
      data: opts.assignmentId
        ? { kind: "homework", assignment_id: opts.assignmentId, route }
        : { kind: "homework" },
    });
  } catch (err) {
    logger.warn({ err, studentId: opts.studentId }, "notifyParentHomeworkGraded failed");
  }
}

/** After bulk grade — one inbox/push per parent for the assignment (not per child). */
export async function notifyParentsHomeworkBulkGraded(opts: {
  studentIds: string[];
  status: "approved" | "starred";
  assignmentId: string;
}): Promise<void> {
  try {
    const { byStudent } = await recipientUserIdsForStudents(opts.studentIds);
    if (byStudent.size === 0) return;

    let assignmentTitle = "homework";
    const [a] = await db
      .select({ title: homework_assignments.title })
      .from(homework_assignments)
      .where(eq(homework_assignments.id, opts.assignmentId))
      .limit(1);
    if (a?.title) assignmentTitle = a.title;

    const starred = opts.status === "starred";
    const route = `/homework-assignment/${opts.assignmentId}`;

    // X-26 (review 2026-08) — the body used opts.studentIds.length (the
    // GLOBAL count across every parent), so a parent of one child in a
    // 30-student bulk grade read "(30 submissions)". Count how many of the
    // TARGET students each recipient actually owns (a parent with two
    // children in this grade, or a student who is their own recipient per
    // Q4, still sees a correct count) and group by that count — one
    // notifyUsers call per distinct count, batching identical copy.
    const countByRecipient = new Map<string, number>();
    for (const recipients of byStudent.values()) {
      for (const uid of recipients) countByRecipient.set(uid, (countByRecipient.get(uid) ?? 0) + 1);
    }
    const recipientsByCount = new Map<number, Set<string>>();
    for (const [uid, n] of countByRecipient) {
      const set = recipientsByCount.get(n) ?? new Set<string>();
      set.add(uid);
      recipientsByCount.set(n, set);
    }

    for (const [n, userIds] of recipientsByCount) {
      await notifyUsers({
        userIds: [...userIds],
        kind: "homework",
        title_en: starred ? "Homework starred" : "Homework approved",
        title_hi: starred ? "गृहकार्य विशेष" : "गृहकार्य स्वीकृत",
        body_en: starred
          ? `Guruji starred work on "${assignmentTitle}" (${n} submission${n === 1 ? "" : "s"}).`
          : `Guruji approved work on "${assignmentTitle}" (${n} submission${n === 1 ? "" : "s"}).`,
        body_hi: starred
          ? `गुरुजी ने "${assignmentTitle}" के कार्य को विशेष बनाया (${n}).`
          : `गुरुजी ने "${assignmentTitle}" के कार्य को स्वीकार किया (${n}).`,
        data: { kind: "homework", assignment_id: opts.assignmentId, route },
      });
    }
  } catch (err) {
    logger.warn({ err }, "notifyParentsHomeworkBulkGraded failed");
  }
}

/** After Guruji returns work for rework — parent must act (F9). */
export async function notifyParentHomeworkReturned(opts: {
  studentId: string;
  assignmentId?: string;
  feedbackNote: string;
}): Promise<void> {
  try {
    // X-27 — active/non-deleted, matching parentUserIdsForStudents.
    const [stu] = await db
      .select({
        parent_id: students.parent_id,
        user_id: students.user_id,
        full_name: students.full_name,
      })
      .from(students)
      .where(and(eq(students.id, opts.studentId), eq(students.status, "active"), isNull(students.deleted_at)))
      .limit(1);
    // X-16 — dual audience: parent AND the student's own Q4 login.
    const userIds = [...new Set([stu?.parent_id, stu?.user_id].filter((id): id is string => !!id))];
    if (userIds.length === 0) return;

    let assignmentTitle = "homework";
    if (opts.assignmentId) {
      const [a] = await db
        .select({ title: homework_assignments.title })
        .from(homework_assignments)
        .where(eq(homework_assignments.id, opts.assignmentId))
        .limit(1);
      if (a?.title) assignmentTitle = a.title;
    }

    const shortName = (stu?.full_name ?? "your child").trim().split(/\s+/)[0] || "your child";
    const note = opts.feedbackNote.trim().slice(0, 200);
    const route = opts.assignmentId ? `/homework-assignment/${opts.assignmentId}` : undefined;

    await notifyUsers({
      userIds,
      kind: "homework",
      title_en: "Homework returned",
      title_hi: "गृहकार्य वापस",
      body_en: `Guruji returned ${shortName}'s work on "${assignmentTitle}" — please revise and resubmit. ${note}`,
      body_hi: `गुरुजी ने ${shortName} के "${assignmentTitle}" कार्य को वापस किया — कृपया सुधारकर पुनः प्रस्तुत करें। ${note}`,
      data: opts.assignmentId
        ? { kind: "homework", assignment_id: opts.assignmentId, route }
        : { kind: "homework" },
    });
  } catch (err) {
    logger.warn({ err, studentId: opts.studentId }, "notifyParentHomeworkReturned failed");
  }
}
