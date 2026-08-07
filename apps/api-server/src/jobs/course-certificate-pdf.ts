/**
 * CU26 — generate bilingual certificate PDF and persist storage_key.
 * Invoked from report.generation when payload.kind === 'course_certificate'.
 */
import { db, course_certificates } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  buildCourseCertificatePdf,
  type CertificateScopeSnapshot,
} from "../lib/course-certificate-pdf";
import { makeKey, storage } from "../lib/storage";
import { logger } from "../lib/logger";

export async function processCourseCertificatePdf(certificateId: string): Promise<void> {
  const id = String(certificateId ?? "");
  if (!id) throw new Error("report.generation course_certificate missing certificate_id");

  const [row] = await db
    .select({
      id: course_certificates.id,
      kind: course_certificates.kind,
      verification_code: course_certificates.verification_code,
      scope_snapshot: course_certificates.scope_snapshot,
      issued_at: course_certificates.issued_at,
      storage_key: course_certificates.storage_key,
      voided_at: course_certificates.voided_at,
    })
    .from(course_certificates)
    .where(eq(course_certificates.id, id))
    .limit(1);

  if (!row) {
    logger.warn({ certificateId: id }, "course certificate PDF — row missing");
    return;
  }
  // Idempotent: already generated (including after void — CU19 keeps the PDF).
  if (row.storage_key) return;

  const snapshot = row.scope_snapshot as CertificateScopeSnapshot;
  if (!snapshot || (snapshot.kind !== "section" && snapshot.kind !== "course")) {
    throw new Error(`course certificate ${id} has an invalid scope_snapshot`);
  }

  const pdf = await buildCourseCertificatePdf({
    kind: row.kind as "section" | "course",
    snapshot,
    verificationCode: row.verification_code,
    issuedAt: row.issued_at,
  });

  const key = makeKey("certificates", `${row.kind}.pdf`);
  await storage.put(key, pdf, "application/pdf");
  await db
    .update(course_certificates)
    .set({ storage_key: key, updated_at: new Date() })
    .where(eq(course_certificates.id, id));
}
