/**
 * CU17–CU23 — certify a node, mint section/course Punya, super_admin correction.
 * Single path for online (and later offline sync). No bulk certify (CU18).
 */
import {
  db,
  centres,
  course_certificates,
  course_sections,
  course_subsections,
  courses,
  student_course_progress,
  students,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { ErrorCode, Role } from "@workspace/api-zod";
import { ErrorCode as Err } from "@workspace/api-zod";
import { awardPunya, creditBalance } from "../lib/punya";
import {
  COURSE_COMPLETED_FEATURE_KEY,
  COURSE_SECTION_FEATURE_KEY,
  courseAwardKey,
  courseReverseKey,
  resolveCourseAwardPoints,
  sectionAwardKey,
  sectionReverseKey,
} from "../lib/course-points";
import { writeAudit } from "../lib/audit";
import {
  issueCourseCertificate,
  issueSectionCertificate,
} from "./course-certificates";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class CourseCertifyError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CourseCertifyError";
  }
}

export type CertifyNodeKind = "section" | "subsection";

async function findLatestUnreversed(opts: {
  tx: Tx;
  studentId: string;
  sourceEntityKind: string;
  sourceEntityId: string;
  featureKey: string;
}): Promise<{ id: string; points: number; idempotency_key: string | null; source_revision: number | null } | null> {
  const result = await opts.tx.execute(sql`
    select t.id, t.points, t.idempotency_key, t.source_revision
    from punya_transactions t
    where t.student_id = ${opts.studentId}::uuid
      and t.source_entity_kind = ${opts.sourceEntityKind}
      and t.source_entity_id = ${opts.sourceEntityId}::uuid
      and t.feature_key = ${opts.featureKey}
      and t.points > 0
      and not exists (
        select 1 from punya_transactions r where r.reversal_of = t.id
      )
    order by t.source_revision desc nulls last, t.created_at desc, t.id desc
    limit 1
  `);
  const rows =
    (
      result as unknown as {
        rows?: Array<{
          id: string;
          points: number;
          idempotency_key: string | null;
          source_revision: number | null;
        }>;
      }
    ).rows ?? [];
  return rows[0] ?? null;
}

/** Course bonus is keyed per trigger section — look up by kind+course id (CU19 §4). */
async function findLatestUnreversedCourseBonus(
  tx: Tx,
  studentId: string,
  courseId: string,
): Promise<{
  id: string;
  points: number;
  idempotency_key: string | null;
  source_revision: number | null;
  source_entity_id: string | null;
} | null> {
  const result = await tx.execute(sql`
    select t.id, t.points, t.idempotency_key, t.source_revision, t.source_entity_id
    from punya_transactions t
    where t.student_id = ${studentId}::uuid
      and t.source_entity_kind = 'course'
      and t.source_entity_id = ${courseId}::uuid
      and t.feature_key = ${COURSE_COMPLETED_FEATURE_KEY}
      and t.points > 0
      and not exists (
        select 1 from punya_transactions r where r.reversal_of = t.id
      )
    order by t.source_revision desc nulls last, t.created_at desc, t.id desc
    limit 1
  `);
  const rows =
    (
      result as unknown as {
        rows?: Array<{
          id: string;
          points: number;
          idempotency_key: string | null;
          source_revision: number | null;
          source_entity_id: string | null;
        }>;
      }
    ).rows ?? [];
  return rows[0] ?? null;
}

async function reverseAward(opts: {
  tx: Tx;
  studentId: string;
  featureKey: string;
  points: number;
  reversalKey: string;
  reversalOf: string;
  sourceEntityKind: string;
  sourceEntityId: string;
  sourceRevision: number;
  awardedBy: string;
  note: string;
}): Promise<{ reversed: boolean; points: number }> {
  const debit = -Math.abs(opts.points);
  const insertResult = await opts.tx.execute(sql`
    insert into punya_transactions (
      student_id, feature_key, points, note, awarded_by,
      idempotency_key, reversal_of, source_entity_kind, source_entity_id, source_revision
    ) values (
      ${opts.studentId}::uuid, ${opts.featureKey}, ${debit},
      ${opts.note}, ${opts.awardedBy}::uuid,
      ${opts.reversalKey}, ${opts.reversalOf}::uuid,
      ${opts.sourceEntityKind}, ${opts.sourceEntityId}::uuid, ${opts.sourceRevision}
    )
    on conflict (idempotency_key) where idempotency_key is not null
    do nothing
    returning id, points
  `);
  const inserted =
    (insertResult as unknown as { rows?: Array<{ id: string; points: number }> }).rows ?? [];
  if (inserted.length === 0) return { reversed: false, points: 0 };
  await creditBalance(opts.tx, opts.studentId, debit);
  return { reversed: true, points: Math.abs(debit) };
}

// M21 — takes the caller's tx handle so this doesn't open a second pool
// connection alongside the certify transaction.
async function studentCityFromCentre(tx: Tx, centreId: string | null): Promise<string | null> {
  if (!centreId) return null;
  const [c] = await tx
    .select({ city_id: centres.city_id })
    .from(centres)
    .where(eq(centres.id, centreId))
    .limit(1);
  return c?.city_id ?? null;
}

async function allSectionsCertified(
  tx: Tx,
  courseId: string,
  studentId: string,
): Promise<boolean> {
  const sections = await tx
    .select({ id: course_sections.id })
    .from(course_sections)
    .where(and(eq(course_sections.course_id, courseId), isNull(course_sections.deleted_at)));
  if (sections.length === 0) return false; // CU25 — empty course issues nothing
  for (const s of sections) {
    const [prog] = await tx
      .select({ certified_at: student_course_progress.certified_at })
      .from(student_course_progress)
      .where(
        and(
          eq(student_course_progress.student_id, studentId),
          eq(student_course_progress.section_id, s.id),
          isNull(student_course_progress.subsection_id),
        ),
      )
      .limit(1);
    if (!prog?.certified_at) return false;
  }
  return true;
}

export type CertifyInput = {
  nodeKind: CertifyNodeKind;
  nodeId: string;
  studentId: string;
  actorId: string;
  actorRole: Role;
  note?: string | null;
  /** Soft-transition when offline (CU17). Online defaults false → 409 if not completed. */
  softTransition?: boolean;
  /** AT19 per-item id from offline queue (optional online). */
  clientOpId?: string | null;
  /** Client clock for certification (offline certified_at). */
  certifiedAt?: Date | null;
  ip?: string | null;
};

export type CertifyResult = {
  progress_id: string;
  section_id: string | null;
  subsection_id: string | null;
  status: string;
  certified_at: string;
  revision: number;
  section_points_awarded: number;
  course_points_awarded: number;
  section_transaction_id: string | null;
  course_transaction_id: string | null;
  course_award_key: string | null;
  /** New certificate rows — caller enqueues PDF after commit (CU26). */
  certificate_ids: string[];
  /** false when already certified — sync maps to duplicate (CU31). */
  applied: boolean;
};

export async function certifyCourseNode(input: CertifyInput): Promise<CertifyResult> {
  return db.transaction(async (tx) => {
    let sectionId: string | null = null;
    let subsectionId: string | null = null;
    let courseId: string;
    let sectionPunyaPoints = 0;
    let coursePunyaPoints = 0;

    if (input.nodeKind === "subsection") {
      const [row] = await tx
        .select({
          id: course_subsections.id,
          section_id: course_subsections.section_id,
          course_id: course_sections.course_id,
        })
        .from(course_subsections)
        .innerJoin(course_sections, eq(course_sections.id, course_subsections.section_id))
        .where(and(eq(course_subsections.id, input.nodeId), isNull(course_subsections.deleted_at)))
        .limit(1);
      if (!row) {
        throw new CourseCertifyError(404, Err.COURSE_NODE_NOT_FOUND, "That course node was not found.");
      }
      subsectionId = row.id;
      sectionId = null; // XOR — subsection progress stores subsection_id only
      courseId = row.course_id;
    } else {
      const [row] = await tx
        .select({
          id: course_sections.id,
          course_id: course_sections.course_id,
          punya_points: course_sections.punya_points,
          course_punya: courses.punya_points,
        })
        .from(course_sections)
        .innerJoin(courses, eq(courses.id, course_sections.course_id))
        .where(and(eq(course_sections.id, input.nodeId), isNull(course_sections.deleted_at)))
        .limit(1);
      if (!row) {
        throw new CourseCertifyError(404, Err.COURSE_NODE_NOT_FOUND, "That course node was not found.");
      }
      sectionId = row.id;
      subsectionId = null;
      courseId = row.course_id;
      sectionPunyaPoints = row.punya_points;
      coursePunyaPoints = row.course_punya;
    }

    // Load existing progress (may be absent — silence is not_started).
    const [existing] = await tx
      .select()
      .from(student_course_progress)
      .where(
        subsectionId
          ? and(
              eq(student_course_progress.student_id, input.studentId),
              eq(student_course_progress.subsection_id, subsectionId),
            )
          : and(
              eq(student_course_progress.student_id, input.studentId),
              eq(student_course_progress.section_id, sectionId!),
              isNull(student_course_progress.subsection_id),
            ),
      )
      .limit(1);

    if (existing?.certified_at) {
      // Idempotent replay of certify (CU31 duplicate) — L8: report the REAL
      // reused award, not a synthetic zero, so a retried request reads the
      // same as the original one did. No second transaction, no second cert.
      let sectionPointsAwarded = 0;
      let sectionTxId: string | null = null;
      let coursePointsAwarded = 0;
      let courseTxId: string | null = null;
      if (sectionId) {
        const priorSection = await findLatestUnreversed({
          tx,
          studentId: input.studentId,
          sourceEntityKind: "course_section",
          sourceEntityId: sectionId,
          featureKey: COURSE_SECTION_FEATURE_KEY,
        });
        if (priorSection) {
          sectionPointsAwarded = priorSection.points;
          sectionTxId = priorSection.id;
        }
        const priorCourse = await findLatestUnreversedCourseBonus(tx, input.studentId, courseId);
        if (priorCourse) {
          coursePointsAwarded = priorCourse.points;
          courseTxId = priorCourse.id;
        }
      }
      return {
        progress_id: existing.id,
        section_id: existing.section_id,
        subsection_id: existing.subsection_id,
        status: existing.status,
        certified_at: existing.certified_at.toISOString(),
        revision: existing.revision,
        section_points_awarded: sectionPointsAwarded,
        course_points_awarded: coursePointsAwarded,
        section_transaction_id: sectionTxId,
        course_transaction_id: courseTxId,
        course_award_key: null,
        certificate_ids: [],
        applied: false,
      };
    }

    const statusNow = existing?.status ?? "not_started";
    // M15 — a legacy 'mastered' row (CU11: the value is dead and never written
    // going forward, but old rows may still carry it) is already as complete
    // as 'completed' for the purposes of this gate.
    const alreadyComplete = statusNow === "completed" || statusNow === "mastered";
    if (!alreadyComplete && !input.softTransition) {
      throw new CourseCertifyError(
        409,
        Err.COURSE_NODE_NOT_COMPLETE,
        "That node must be completed before it can be certified — close it first.",
      );
    }

    const now = input.certifiedAt ?? new Date();
    const values = {
      student_id: input.studentId,
      section_id: sectionId,
      subsection_id: subsectionId,
      status: "completed" as const,
      note: existing?.note ?? null,
      started_at: existing?.started_at ?? now,
      completed_at: existing?.completed_at ?? now,
      certified_at: now,
      certified_by: input.actorId,
      certification_note: input.note ?? null,
      updated_by: input.actorId,
      updated_by_role: input.actorRole,
      client_op_id: input.clientOpId ?? existing?.client_op_id ?? null,
    };

    let progressRow: typeof existing | undefined;
    if (subsectionId) {
      const [row] = await tx
        .insert(student_course_progress)
        .values(values)
        .onConflictDoUpdate({
          target: [student_course_progress.student_id, student_course_progress.subsection_id],
          targetWhere: sql`${student_course_progress.subsection_id} is not null`,
          set: {
            status: "completed",
            completed_at: sql`coalesce(${student_course_progress.completed_at}, now())`,
            started_at: sql`coalesce(${student_course_progress.started_at}, now())`,
            certified_at: now,
            certified_by: input.actorId,
            certification_note: input.note ?? null,
            updated_by: input.actorId,
            updated_by_role: input.actorRole,
            updated_at: now,
            ...(input.clientOpId ? { client_op_id: input.clientOpId } : {}),
          },
          setWhere: sql`${student_course_progress.certified_at} is null`,
        })
        .returning();
      progressRow = row;
    } else {
      const [row] = await tx
        .insert(student_course_progress)
        .values(values)
        .onConflictDoUpdate({
          target: [student_course_progress.student_id, student_course_progress.section_id],
          targetWhere: sql`${student_course_progress.section_id} is not null`,
          set: {
            status: "completed",
            completed_at: sql`coalesce(${student_course_progress.completed_at}, now())`,
            started_at: sql`coalesce(${student_course_progress.started_at}, now())`,
            certified_at: now,
            certified_by: input.actorId,
            certification_note: input.note ?? null,
            updated_by: input.actorId,
            updated_by_role: input.actorRole,
            updated_at: now,
            ...(input.clientOpId ? { client_op_id: input.clientOpId } : {}),
          },
          setWhere: sql`${student_course_progress.certified_at} is null`,
        })
        .returning();
      progressRow = row;
    }

    if (!progressRow) {
      throw new CourseCertifyError(
        409,
        Err.COURSE_NODE_CERTIFIED,
        "That node is already certified — only a super_admin correction can change it.",
      );
    }

    const revision = progressRow.revision;
    let sectionPointsAwarded = 0;
    let sectionTxId: string | null = null;
    let coursePointsAwarded = 0;
    let courseTxId: string | null = null;
    let courseKey: string | null = null;
    const certificateIds: string[] = [];

    // Sub-section stars never carry Punya (CU21). Certificates only on section rows (CU25).
    if (input.nodeKind === "section" && sectionId) {
      const [stu] = await tx
        .select({ centre_id: students.centre_id })
        .from(students)
        .where(eq(students.id, input.studentId))
        .limit(1);
      const cityId = await studentCityFromCentre(tx, stu?.centre_id ?? null);

      const awardPoints = await resolveCourseAwardPoints(
        COURSE_SECTION_FEATURE_KEY,
        sectionPunyaPoints,
        cityId,
      );
      if (awardPoints > 0) {
        const key = sectionAwardKey(sectionId, input.studentId, revision);
        const award = await awardPunya(
          {
            studentId: input.studentId,
            featureKey: COURSE_SECTION_FEATURE_KEY,
            points: awardPoints,
            note: "Course section certified",
            awardedBy: input.actorId,
            idempotencyKey: key,
            sourceEntityKind: "course_section",
            sourceEntityId: sectionId,
            sourceRevision: revision,
          },
          tx,
        );
        // AT20: balance only moves when the guarded insert returned a row.
        // awardPunya already does this; surface returned amount.
        if (award.awarded) {
          sectionPointsAwarded = award.points_awarded;
          sectionTxId = award.transaction_id;
        } else {
          sectionPointsAwarded = 0;
          sectionTxId = award.transaction_id;
        }
      }

      // CU25 — section certificate when this section's own row is certified.
      const sectionCert = await issueSectionCertificate(
        {
          studentId: input.studentId,
          courseId,
          sectionId,
          actorId: input.actorId,
        },
        tx,
      );
      if (sectionCert?.created) certificateIds.push(sectionCert.certificateId);

      // Course milestone when every section is certified (CU25 / CU21).
      if (await allSectionsCertified(tx, courseId, input.studentId)) {
        const [courseRow] = await tx
          .select({ punya_points: courses.punya_points })
          .from(courses)
          .where(eq(courses.id, courseId))
          .limit(1);
        const authored = courseRow?.punya_points ?? coursePunyaPoints;
        const coursePts = await resolveCourseAwardPoints(
          COURSE_COMPLETED_FEATURE_KEY,
          authored,
          cityId,
        );
        if (coursePts > 0) {
          courseKey = courseAwardKey(courseId, input.studentId, sectionId, revision);
          const award = await awardPunya(
            {
              studentId: input.studentId,
              featureKey: COURSE_COMPLETED_FEATURE_KEY,
              points: coursePts,
              note: "Course fully certified",
              awardedBy: input.actorId,
              idempotencyKey: courseKey,
              sourceEntityKind: "course",
              sourceEntityId: courseId,
              sourceRevision: revision,
            },
            tx,
          );
          if (award.awarded) {
            coursePointsAwarded = award.points_awarded;
            courseTxId = award.transaction_id;
          } else {
            courseTxId = award.transaction_id;
          }
        }

        const courseCert = await issueCourseCertificate(
          {
            studentId: input.studentId,
            courseId,
            actorId: input.actorId,
          },
          tx,
        );
        if (courseCert?.created) certificateIds.push(courseCert.certificateId);
      }
    }

    await writeAudit(
      {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: "approve",
        entityKind: "course_certification",
        entityId: progressRow.id,
        summary: `Certified course ${input.nodeKind}.`,
        metadata: {
          student_id: input.studentId,
          node_kind: input.nodeKind,
          node_id: input.nodeId,
          section_id: sectionId,
          subsection_id: subsectionId,
          course_id: courseId,
          section_points_awarded: sectionPointsAwarded,
          course_points_awarded: coursePointsAwarded,
          course_award_key: courseKey,
          certificate_ids: certificateIds,
        },
        ip: input.ip ?? null,
      },
      tx,
    );

    return {
      progress_id: progressRow.id,
      section_id: progressRow.section_id,
      subsection_id: progressRow.subsection_id,
      status: progressRow.status,
      certified_at: (progressRow.certified_at ?? now).toISOString(),
      revision,
      section_points_awarded: sectionPointsAwarded,
      course_points_awarded: coursePointsAwarded,
      section_transaction_id: sectionTxId,
      course_transaction_id: courseTxId,
      course_award_key: courseKey,
      certificate_ids: certificateIds,
      applied: true,
    };
  });
}

export type CorrectCertifyInput = {
  nodeKind: CertifyNodeKind;
  nodeId: string;
  studentId: string;
  actorId: string;
  /** Real caller role (H26) — the service enforces super_admin itself, not just the route. */
  actorRole: Role;
  /** Optional status after clearing certification. */
  status?: "not_started" | "in_progress" | "completed";
  ip?: string | null;
};

/**
 * CU19 — super_admin correction: bump revision, clear star, reverse Punya, void certs.
 */
export async function correctCourseCertification(input: CorrectCertifyInput): Promise<{
  revision: number;
  section_points_reversed: number;
  course_points_reversed: number;
}> {
  // H26 — Q2's house rule: role checks on value-minting/reversing operations
  // live in the SERVICE layer, not only on the route's requireMinRole.
  if (input.actorRole !== "super_admin") {
    throw new CourseCertifyError(
      403,
      Err.FORBIDDEN,
      "Only a super_admin may correct a course certification.",
    );
  }
  return db.transaction(async (tx) => {
    let sectionId: string | null = null;
    let subsectionId: string | null = null;
    let courseId: string;

    if (input.nodeKind === "subsection") {
      const [row] = await tx
        .select({
          id: course_subsections.id,
          course_id: course_sections.course_id,
        })
        .from(course_subsections)
        .innerJoin(course_sections, eq(course_sections.id, course_subsections.section_id))
        .where(and(eq(course_subsections.id, input.nodeId), isNull(course_subsections.deleted_at)))
        .limit(1);
      if (!row) {
        throw new CourseCertifyError(404, Err.COURSE_NODE_NOT_FOUND, "That course node was not found.");
      }
      subsectionId = row.id;
      courseId = row.course_id;
    } else {
      const [row] = await tx
        .select({ id: course_sections.id, course_id: course_sections.course_id })
        .from(course_sections)
        .where(and(eq(course_sections.id, input.nodeId), isNull(course_sections.deleted_at)))
        .limit(1);
      if (!row) {
        throw new CourseCertifyError(404, Err.COURSE_NODE_NOT_FOUND, "That course node was not found.");
      }
      sectionId = row.id;
      courseId = row.course_id;
    }

    const [existing] = await tx
      .select()
      .from(student_course_progress)
      .where(
        subsectionId
          ? and(
              eq(student_course_progress.student_id, input.studentId),
              eq(student_course_progress.subsection_id, subsectionId),
            )
          : and(
              eq(student_course_progress.student_id, input.studentId),
              eq(student_course_progress.section_id, sectionId!),
              isNull(student_course_progress.subsection_id),
            ),
      )
      .limit(1);

    if (!existing?.certified_at) {
      throw new CourseCertifyError(
        409,
        Err.INVALID_STATE,
        "That node is not certified — there is nothing to correct.",
      );
    }

    // C1 — a sub-section correction touches only its own progress row.
    // Sub-sections carry no Punya (CU21) and are not part of CU25's
    // course-complete predicate, so there is nothing course-level to reverse
    // or void; computing this for a subsection would key off whether the
    // COURSE happens to be fully certified via unrelated sections, not
    // whether THIS correction changed that.
    const wasCourseComplete =
      input.nodeKind === "section"
        ? await allSectionsCertified(tx, courseId, input.studentId)
        : false;
    const newRevision = existing.revision + 1;
    const newStatus = input.status ?? existing.status;

    await tx
      .update(student_course_progress)
      .set({
        revision: newRevision,
        certified_at: null,
        certified_by: null,
        certification_note: null,
        status: newStatus,
        completed_at: newStatus === "completed" ? existing.completed_at ?? new Date() : null,
        started_at:
          newStatus === "not_started" ? null : existing.started_at ?? new Date(),
        updated_by: input.actorId,
        updated_by_role: input.actorRole,
        updated_at: new Date(),
      })
      .where(eq(student_course_progress.id, existing.id));

    let sectionReversed = 0;
    let courseReversed = 0;

    if (input.nodeKind === "section" && sectionId) {
      const prior = await findLatestUnreversed({
        tx,
        studentId: input.studentId,
        sourceEntityKind: "course_section",
        sourceEntityId: sectionId,
        featureKey: COURSE_SECTION_FEATURE_KEY,
      });
      if (prior && prior.points > 0) {
        const rev = await reverseAward({
          tx,
          studentId: input.studentId,
          featureKey: COURSE_SECTION_FEATURE_KEY,
          points: prior.points,
          reversalKey: sectionReverseKey(sectionId, input.studentId, newRevision),
          reversalOf: prior.id,
          sourceEntityKind: "course_section",
          sourceEntityId: sectionId,
          sourceRevision: newRevision,
          awardedBy: input.actorId,
          note: "Course section certification correction",
        });
        if (rev.reversed) sectionReversed = rev.points;
      }

      // Void section certificate if present (CU19 / CU24) — PDF is retained.
      await tx
        .update(course_certificates)
        .set({ voided_at: new Date(), voided_by: input.actorId, updated_at: new Date() })
        .where(
          and(
            eq(course_certificates.student_id, input.studentId),
            eq(course_certificates.section_id, sectionId),
            isNull(course_certificates.voided_at),
          ),
        );
    }

    if (wasCourseComplete) {
      const priorCourse = await findLatestUnreversedCourseBonus(tx, input.studentId, courseId);
      if (priorCourse && priorCourse.points > 0) {
        // Parse trigger section from award key, or fall back to corrected section.
        let triggerSectionId = sectionId ?? "";
        let triggerRevision = priorCourse.source_revision ?? 0;
        const key = priorCourse.idempotency_key ?? "";
        // course_completed:{course}:{student}:{trigger}:{revision}
        const parts = key.split(":");
        if (parts.length >= 5 && parts[0] === "course_completed") {
          triggerSectionId = parts[3]!;
          triggerRevision = Number(parts[4]) || triggerRevision;
        }
        const rev = await reverseAward({
          tx,
          studentId: input.studentId,
          featureKey: COURSE_COMPLETED_FEATURE_KEY,
          points: priorCourse.points,
          reversalKey: courseReverseKey(
            courseId,
            input.studentId,
            triggerSectionId,
            newRevision,
          ),
          reversalOf: priorCourse.id,
          sourceEntityKind: "course",
          sourceEntityId: courseId,
          sourceRevision: newRevision,
          awardedBy: input.actorId,
          note: "Course completion bonus correction",
        });
        if (rev.reversed) courseReversed = rev.points;
      }

      await tx
        .update(course_certificates)
        .set({ voided_at: new Date(), voided_by: input.actorId, updated_at: new Date() })
        .where(
          and(
            eq(course_certificates.student_id, input.studentId),
            eq(course_certificates.course_id, courseId),
            isNull(course_certificates.section_id),
            isNull(course_certificates.voided_at),
          ),
        );
    }

    // Two audit entries (CU19): one for the correction itself, one naming the
    // acting super_admin. actorId/actorRole already carry "who" on every audit
    // row, so the second entry must not repeat that in its metadata (L7) — it
    // carries only what the first doesn't.
    await writeAudit(
      {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: "update",
        entityKind: "course_certification",
        entityId: existing.id,
        summary: "Super_admin corrected a course certification.",
        metadata: {
          student_id: input.studentId,
          node_kind: input.nodeKind,
          node_id: input.nodeId,
          revision: newRevision,
          section_points_reversed: sectionReversed,
          course_points_reversed: courseReversed,
        },
        ip: input.ip ?? null,
      },
      tx,
    );
    await writeAudit(
      {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: "update",
        entityKind: "course_certification",
        entityId: existing.id,
        summary: "Correction performed by the acting super_admin.",
        ip: input.ip ?? null,
      },
      tx,
    );

    return {
      revision: newRevision,
      section_points_reversed: sectionReversed,
      course_points_reversed: courseReversed,
    };
  });
}
