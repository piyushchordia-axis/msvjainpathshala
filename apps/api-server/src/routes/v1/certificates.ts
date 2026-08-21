/**
 * Public certificate verification (CU27) — no auth, rate-limited, minimal PII.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, course_certificates } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ok, fail } from "../../lib/envelope";
import { rateLimit } from "../../lib/ratelimit";
import { firstName } from "../../lib/route-helpers";
import type { CertificateScopeSnapshot } from "../../lib/course-certificate-pdf";

const router: IRouter = Router();

/** Crockford base32, 12 chars — reject anything else before hitting the DB. */
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/i;

function titlesFromSnapshot(snap: CertificateScopeSnapshot | null): {
  title_en: string;
  title_hi: string | null;
} {
  if (!snap) return { title_en: "", title_hi: null };
  if (snap.kind === "section") {
    return { title_en: snap.section_title_en, title_hi: snap.section_title_hi };
  }
  return { title_en: snap.course_name_en, title_hi: snap.course_name_hi };
}

/* GET /v1/certificates/verify/:code — public (CU27) */
router.get("/verify/:code", async (req: Request, res: Response) => {
  // req.ip resolves through Express's `trust proxy` setting (app.ts) — the
  // same single-hop config the OTP-send/verify limiters rely on. Do not read
  // x-forwarded-for directly; a client controls that header.
  const ip = req.ip || "unknown";
  // Enumerable by construction — tight per-IP window.
  if (await rateLimit(`cert:verify:ip:${ip}`, 30, 60)) {
    fail(res, 429, "ERR_RATE_LIMITED", "Too many verification attempts — wait a minute and try again.");
    return;
  }

  const code = String(req.params.code ?? "").trim().toUpperCase();
  if (!CODE_RE.test(code)) {
    ok(res, {
      validity: "not_found" as const,
      title_en: null,
      title_hi: null,
      issued_at: null,
      student_first_name: null,
    });
    return;
  }

  const [row] = await db
    .select({
      voided_at: course_certificates.voided_at,
      issued_at: course_certificates.issued_at,
      scope_snapshot: course_certificates.scope_snapshot,
    })
    .from(course_certificates)
    .where(eq(course_certificates.verification_code, code))
    .limit(1);

  if (!row) {
    ok(res, {
      validity: "not_found" as const,
      title_en: null,
      title_hi: null,
      issued_at: null,
      student_first_name: null,
    });
    return;
  }

  const snap = row.scope_snapshot as CertificateScopeSnapshot;
  const titles = titlesFromSnapshot(snap);
  const fullName =
    snap && typeof snap.student_full_name === "string" ? snap.student_full_name : null;

  ok(res, {
    validity: row.voided_at ? ("void" as const) : ("valid" as const),
    title_en: titles.title_en || null,
    title_hi: titles.title_hi,
    issued_at: row.issued_at.toISOString(),
    student_first_name: firstName(fullName),
  });
});

export default router;
