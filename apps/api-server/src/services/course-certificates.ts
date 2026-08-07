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
import { and, asc, eq, isNull } from "drizzle-orm";
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
  if (values.kind === "section" && values.section_id) {
    const [existing] = await client
      .select({ id: course_certificates.id })
      .from(course_certificates)
      .where(
        and(
          eq(course_certificates.student_id, values.student_id),
          eq(course_certificates.section_id, values.section_id),
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
      ),
    )
    .limit(1);
  return existing?.id ?? null;
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

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateVerificationCode();
    try {
      const [row] = await client
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
      if (row) return { id: row.id, created: true };
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
