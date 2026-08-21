/**
 * CU24–CU26 — issue course/section certificate rows and enqueue PDF generation.
 */
import { randomBytes } from "node:crypto";
import {
  db,
  course_certificates,
  course_sections,
  courses,
  students,
  users,
} from "@workspace/db";
import { and, asc, eq, isNull, isNotNull } from "drizzle-orm";
import { QUEUE_NAMES } from "@jp/shared/constants";
import { enqueueJob } from "../lib/queues";
import { logger } from "../lib/logger";
import {
  honorificForGender,
  type CertificateScopeSnapshot,
  type CourseScopeSnapshot,
  type SectionScopeSnapshot,
} from "../lib/course-certificate-pdf";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

/** Crockford base32 alphabet (no I, L, O, U). */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 12 chars (~60 bits) from CSPRNG — CU24. */
export function generateVerificationCode(): string {
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i += 1) {
    out += CROCKFORD[bytes[i]! % 32]!;
  }
  return out;
}

async function findExistingCertificate(
  client: DbOrTx,
  values: {
    student_id: string;
    course_id: string;
    section_id: string | null;
    kind: "section" | "course";
  },
): Promise<string | null> {
  // C2 — a voided row is not a live certificate; without this filter,
  // re-certification after a CU19 correction finds the voided row here and
  // reports created:false, leaving the certificate void forever.
  if (values.kind === "section" && values.section_id) {
    const [existing] = await client
      .select({ id: course_certificates.id })
      .from(course_certificates)
      .where(
        and(
          eq(course_certificates.student_id, values.student_id),
          eq(course_certificates.section_id, values.section_id),
          isNull(course_certificates.voided_at),
        ),
      )
      .limit(1);
    return existing?.id ?? null;
  }
  const [existing] = await client
    .select({ id: course_certificates.id })
    .from(course_certificates)
    .where(
      and(
        eq(course_certificates.student_id, values.student_id),
        eq(course_certificates.course_id, values.course_id),
        isNull(course_certificates.section_id),
        isNull(course_certificates.voided_at),
      ),
    )
    .limit(1);
  return existing?.id ?? null;
}

/** C2 — separate lookup for a VOIDED row at the same (student, course|section). */
async function findVoidedCertificate(
  client: DbOrTx,
  values: {
    student_id: string;
    course_id: string;
    section_id: string | null;
    kind: "section" | "course";
  },
): Promise<string | null> {
  if (values.kind === "section" && values.section_id) {
    const [existing] = await client
      .select({ id: course_certificates.id })
      .from(course_certificates)
      .where(
        and(
          eq(course_certificates.student_id, values.student_id),
          eq(course_certificates.section_id, values.section_id),
          isNotNull(course_certificates.voided_at),
        ),
      )
      .limit(1);
    return existing?.id ?? null;
  }
  const [existing] = await client
    .select({ id: course_certificates.id })
    .from(course_certificates)
    .where(
      and(
        eq(course_certificates.student_id, values.student_id),
        eq(course_certificates.course_id, values.course_id),
        isNull(course_certificates.section_id),
        isNotNull(course_certificates.voided_at),
      ),
    )
    .limit(1);
  return existing?.id ?? null;
}

/**
 * C2 — revive a voided certificate in place rather than issuing a second row:
 * the partial unique indexes (CU24) on (student_id, section_id) and
 * (student_id, course_id) forbid a second live row for the same target anyway,
 * and CU19 says a later correct re-certification must clear the void fields
 * and re-issue, not leave the certificate voided forever. The verification
 * code and id are kept — a printed certificate a family already holds becomes
 * valid again instead of orphaned.
 */
async function reviveVoidedCertificate(
  client: DbOrTx,
  id: string,
  scopeSnapshot: CertificateScopeSnapshot,
): Promise<void> {
  await client
    .update(course_certificates)
    .set({
      voided_at: null,
      voided_by: null,
      scope_snapshot: scopeSnapshot as Record<string, unknown>,
      issued_at: new Date(),
      storage_key: null,
      updated_at: new Date(),
    })
    .where(eq(course_certificates.id, id));
}

async function insertCertificateWithCodeRetry(
  client: DbOrTx,
  values: {
    student_id: string;
    course_id: string;
    section_id: string | null;
    kind: "section" | "course";
    scope_snapshot: CertificateScopeSnapshot;
  },
): Promise<{ id: string; created: boolean }> {
  const already = await findExistingCertificate(client, values);
  if (already) return { id: already, created: false };

  const voided = await findVoidedCertificate(client, values);
  if (voided) {
    await reviveVoidedCertificate(client, voided, values.scope_snapshot);
    // `created` also means "needs a (re)generated PDF" to the caller
    // (course-certify.ts pushes onto certificate_ids only when true) — a
    // revived certificate needs exactly that, so it is true here too.
    return { id: voided, created: true };
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateVerificationCode();
    try {
      // H27 — each attempt runs in its own SAVEPOINT so a verification_code
      // collision only rolls back this attempt, not the caller's whole
      // transaction (this can run inside the certify tx).
      const insertedId = await client.transaction(async (savepointTx) => {
        const [row] = await savepointTx
          .insert(course_certificates)
          .values({
            student_id: values.student_id,
            course_id: values.course_id,
            section_id: values.section_id,
            kind: values.kind,
            verification_code: code,
            scope_snapshot: values.scope_snapshot as Record<string, unknown>,
            storage_key: null,
          })
          .returning({ id: course_certificates.id });
        return row?.id ?? null;
      });
      if (insertedId) return { id: insertedId, created: true };
    } catch (err: unknown) {
      const pgCode = (err as { code?: string })?.code;
      if (pgCode !== "23505") throw err;
      // Already issued (race) vs verification_code collision — only retry the latter.
      const existing = await findExistingCertificate(client, values);
      if (existing) return { id: existing, created: false };
    }
  }
  throw new Error("Could not mint a unique verification_code for course certificate.");
}

async function loadCertifierContext(
  client: DbOrTx,
  actorId: string,
  studentId: string,
): Promise<{
  honorific: ReturnType<typeof honorificForGender>;
  certifiedByName: string | null;
  studentFullName: string;
}> {
  const [actor] = await client
    .select({ full_name: users.full_name, gender: users.gender })
    .from(users)
    .where(eq(users.id, actorId))
    .limit(1);
  const [stu] = await client
    .select({ full_name: students.full_name })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  return {
    honorific: honorificForGender(actor?.gender),
    certifiedByName: actor?.full_name ?? null,
    studentFullName: stu?.full_name ?? "Student",
  };
}

/**
 * Issue a section certificate when the section's own row is certified (CU25).
 * Returns certificate id when a new row was created (caller should enqueue PDF).
 */
export async function issueSectionCertificate(
  opts: {
    studentId: string;
    courseId: string;
    sectionId: string;
    actorId: string;
  },
  tx?: Tx,
): Promise<{ certificateId: string; created: boolean } | null> {
  const client: DbOrTx = tx ?? db;
  const [course] = await client
    .select({
      id: courses.id,
      name_en: courses.name_en,
      name_hi: courses.name_hi,
    })
    .from(courses)
    .where(eq(courses.id, opts.courseId))
    .limit(1);
  const [section] = await client
    .select({
      id: course_sections.id,
      title_en: course_sections.title_en,
      title_hi: course_sections.title_hi,
    })
    .from(course_sections)
    .where(and(eq(course_sections.id, opts.sectionId), isNull(course_sections.deleted_at)))
    .limit(1);
  if (!course || !section) return null;

  const ctx = await loadCertifierContext(client, opts.actorId, opts.studentId);
  const snapshot: SectionScopeSnapshot = {
    kind: "section",
    course_id: course.id,
    course_name_en: course.name_en,
    course_name_hi: course.name_hi,
    section_id: section.id,
    section_title_en: section.title_en,
    section_title_hi: section.title_hi,
    certified_by_name: ctx.certifiedByName,
    honorific_en: ctx.honorific.en,
    honorific_hi: ctx.honorific.hi,
    student_full_name: ctx.studentFullName,
  };

  const inserted = await insertCertificateWithCodeRetry(client, {
    student_id: opts.studentId,
    course_id: opts.courseId,
    section_id: opts.sectionId,
    kind: "section",
    scope_snapshot: snapshot,
  });
  return { certificateId: inserted.id, created: inserted.created };
}

/**
 * Issue a course certificate when every non-deleted section is certified (CU25).
 * Zero-section courses must not call this (vacuous truth).
 */
export async function issueCourseCertificate(
  opts: {
    studentId: string;
    courseId: string;
    actorId: string;
  },
  tx?: Tx,
): Promise<{ certificateId: string; created: boolean } | null> {
  const client: DbOrTx = tx ?? db;
  const sections = await client
    .select({
      id: course_sections.id,
      title_en: course_sections.title_en,
      title_hi: course_sections.title_hi,
    })
    .from(course_sections)
    .where(and(eq(course_sections.course_id, opts.courseId), isNull(course_sections.deleted_at)))
    .orderBy(asc(course_sections.order_index));

  // CU25 — empty course issues nothing.
  if (sections.length === 0) return null;

  const [course] = await client
    .select({
      id: courses.id,
      name_en: courses.name_en,
      name_hi: courses.name_hi,
    })
    .from(courses)
    .where(eq(courses.id, opts.courseId))
    .limit(1);
  if (!course) return null;

  const ctx = await loadCertifierContext(client, opts.actorId, opts.studentId);
  const snapshot: CourseScopeSnapshot = {
    kind: "course",
    course_id: course.id,
    course_name_en: course.name_en,
    course_name_hi: course.name_hi,
    sections: sections.map((s) => ({
      id: s.id,
      title_en: s.title_en,
      title_hi: s.title_hi,
    })),
    certified_by_name: ctx.certifiedByName,
    honorific_en: ctx.honorific.en,
    honorific_hi: ctx.honorific.hi,
    student_full_name: ctx.studentFullName,
  };

  const inserted = await insertCertificateWithCodeRetry(client, {
    student_id: opts.studentId,
    course_id: opts.courseId,
    section_id: null,
    kind: "course",
    scope_snapshot: snapshot,
  });
  return { certificateId: inserted.id, created: inserted.created };
}

export async function enqueueCertificatePdf(certificateId: string): Promise<void> {
  try {
    await enqueueJob(QUEUE_NAMES.REPORT_GENERATION, {
      kind: "course_certificate",
      certificate_id: certificateId,
    });
  } catch (err) {
    logger.warn({ err, certificateId }, "course certificate PDF enqueue failed");
  }
}
