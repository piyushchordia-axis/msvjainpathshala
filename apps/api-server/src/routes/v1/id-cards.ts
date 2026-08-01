/**
 * /v1/id-cards — Digital ID cards (QR + PNG).
 *
 * Admins (panel) generate/regenerate a signed, scannable ID card for a student
 * in their centre scope and read it back. The owning parent/student reads their
 * own card via /mine. A signed QR payload can be verified by any authed caller
 * (shivir scanner / shikshak) via /verify using a constant-time HMAC check.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, digital_id_cards, students, centres } from "@workspace/db";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, type AdminScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import { signUploadUrl } from "../../lib/file-tokens";
import { verifyCardSignature } from "../../lib/idcard-crypto";
import { upsertIdCardArt } from "../../lib/idcard-render";

const router: IRouter = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---- local helper copy-pasted into admin route files ---- */
function inScope(scope: AdminScope, centreId: string | null): boolean {
  if (scope.centreIds === null) return true;
  if (!centreId) return false;
  return scope.centreIds.includes(centreId);
}

/* POST /v1/id-cards/generate-all — generate/regenerate for every scoped student */
router.post("/generate-all", requireAdminPanel, async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const onlyMissing = req.body?.only_missing === true;

  const centreFilter =
    scope.centreIds === null
      ? undefined
      : scope.centreIds.length === 0
        ? sql`false`
        : inArray(students.centre_id, scope.centreIds);

  const studentRows = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      student_code: students.student_code,
      centre_id: students.centre_id,
      msv_status: students.msv_status,
      photo_url: students.photo_url,
      centre_name: centres.name,
    })
    .from(students)
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .where(and(isNull(students.deleted_at), eq(students.status, "active"), centreFilter));

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ student_id: string; message: string }> = [];

  for (const student of studentRows) {
    try {
      const [existing] = await db
        .select({ student_id: digital_id_cards.student_id })
        .from(digital_id_cards)
        .where(eq(digital_id_cards.student_id, student.id))
        .limit(1);
      if (onlyMissing && existing) {
        skipped += 1;
        continue;
      }

      await upsertIdCardArt({
        studentId: student.id,
        fullName: student.full_name ?? student.student_code,
        studentCode: student.student_code,
        centreName: student.centre_name ?? "—",
        msvBadge: student.msv_status === "approved",
        photoUrl: student.photo_url,
        rotateQr: true,
      });
      generated += 1;
    } catch (err) {
      failed += 1;
      errors.push({
        student_id: student.id,
        message: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  await auditFromReq(req, {
    action: "create",
    entityKind: "digital_id_card",
    summary: `Bulk ID card generation: ${generated} generated, ${skipped} skipped, ${failed} failed.`,
    metadata: { generated, skipped, failed, only_missing: onlyMissing },
  });

  ok(res, { generated, skipped, failed, total: studentRows.length, errors: errors.slice(0, 20) });
});

/* POST /v1/id-cards/generate/:studentId — admin generate/regenerate (scoped) */
router.post(
  "/generate/:studentId",
  requireAdminPanel,
  async (req: Request, res: Response) => {
    const studentId = String(req.params.studentId);
    if (!UUID_RE.test(studentId)) {
      fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
      return;
    }
    const scope = await resolveAdminScope(req.authUser!);
    const [student] = await db
      .select({
        id: students.id,
        full_name: students.full_name,
        student_code: students.student_code,
        centre_id: students.centre_id,
        msv_status: students.msv_status,
        photo_url: students.photo_url,
        centre_name: centres.name,
      })
      .from(students)
      .leftJoin(centres, eq(centres.id, students.centre_id))
      .where(eq(students.id, studentId))
      .limit(1);
    if (!student || !inScope(scope, student.centre_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
      return;
    }

    const [existing] = await db
      .select({ version_no: digital_id_cards.version_no })
      .from(digital_id_cards)
      .where(eq(digital_id_cards.student_id, studentId))
      .limit(1);

    const row = await upsertIdCardArt({
      studentId,
      fullName: student.full_name ?? student.student_code,
      studentCode: student.student_code,
      centreName: student.centre_name ?? "—",
      msvBadge: student.msv_status === "approved",
      photoUrl: student.photo_url,
      rotateQr: true,
    });

    await auditFromReq(req, {
      action: "create",
      entityKind: "digital_id_card",
      entityId: studentId,
      summary: `ID card ${existing ? "regenerated" : "generated"} (${row.card_number}, v${row.version_no}).`,
      metadata: { card_number: row.card_number, version_no: row.version_no },
    });

    ok(res, { ...row, png_url: signUploadUrl(row.png_url) });
  },
);

/* GET /v1/id-cards/mine?student_id= — owner (parent/student) reads their card */
router.get("/mine", async (req: Request, res: Response) => {
  const parsed = z.object({ student_id: z.string().uuid() }).safeParse(req.query);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "A valid student_id is required.");
    return;
  }
  const studentId = parsed.data.student_id;
  const uid = req.authUser!.id;
  const [owned] = await db
    .select({ id: students.id })
    .from(students)
    .where(
      and(eq(students.id, studentId), or(eq(students.parent_id, uid), eq(students.user_id, uid))),
    )
    .limit(1);
  if (!owned) {
    fail(res, 404, "ERR_NOT_FOUND", "Card not found.");
    return;
  }
  const [card] = await db
    .select({
      student_id: digital_id_cards.student_id,
      card_number: digital_id_cards.card_number,
      png_url: digital_id_cards.png_url,
      qr_payload: digital_id_cards.qr_payload,
      qr_signature: digital_id_cards.qr_signature,
      msv_badge: digital_id_cards.msv_badge,
      version_no: digital_id_cards.version_no,
      is_active: digital_id_cards.is_active,
      generated_at: digital_id_cards.generated_at,
      last_regenerated_at: digital_id_cards.last_regenerated_at,
      photo_url: students.photo_url,
    })
    .from(digital_id_cards)
    .innerJoin(students, eq(students.id, digital_id_cards.student_id))
    .where(eq(digital_id_cards.student_id, studentId))
    .limit(1);
  if (!card) {
    fail(res, 404, "ERR_NOT_FOUND", "Card not found.");
    return;
  }
  ok(res, {
    ...card,
    png_url: signUploadUrl(card.png_url),
    photo_url: signUploadUrl(card.photo_url),
    generated_at: card.generated_at ? card.generated_at.toISOString() : null,
    last_regenerated_at: card.last_regenerated_at ? card.last_regenerated_at.toISOString() : null,
  });
});

const verifySchema = z.object({
  qr_payload: z.string().min(1).max(2000),
  qr_signature: z.string().min(1).max(256),
});

/* POST /v1/id-cards/verify — constant-time HMAC verify (shivir scanner / shikshak) */
router.post("/verify", async (req: Request, res: Response) => {
  let body: z.infer<typeof verifySchema>;
  try {
    body = verifySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid verify payload.");
    return;
  }
  if (!verifyCardSignature(body.qr_payload, body.qr_signature)) {
    fail(res, 401, "ERR_SIGNATURE_INVALID", "Signature is invalid.");
    return;
  }

  let parsedPayload: { student_id?: unknown; v?: unknown };
  try {
    parsedPayload = JSON.parse(body.qr_payload);
  } catch {
    fail(res, 401, "ERR_SIGNATURE_INVALID", "Signature is invalid.");
    return;
  }
  const studentId = parsedPayload.student_id;
  const payloadVersion = parsedPayload.v;
  if (typeof studentId !== "string" || !UUID_RE.test(studentId)) {
    fail(res, 401, "ERR_SIGNATURE_INVALID", "Signature is invalid.");
    return;
  }

  // Signature is authentic, but the QR may be stale/revoked: a regenerated card
  // bumps version_no, and a deactivated card sets is_active=false. Re-check the
  // current card row so old/revoked QRs no longer verify.
  const [currentCard] = await db
    .select({ version_no: digital_id_cards.version_no, is_active: digital_id_cards.is_active })
    .from(digital_id_cards)
    .where(eq(digital_id_cards.student_id, studentId))
    .limit(1);
  if (!currentCard || !currentCard.is_active || currentCard.version_no !== payloadVersion) {
    fail(res, 401, "ERR_SIGNATURE_INVALID", "Signature is invalid.");
    return;
  }

  const [student] = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      student_code: students.student_code,
      centre_name: centres.name,
    })
    .from(students)
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .where(eq(students.id, studentId))
    .limit(1);
  if (!student) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }

  ok(res, {
    valid: true,
    student: {
      id: student.id,
      full_name: student.full_name,
      student_code: student.student_code,
      centre_name: student.centre_name,
    },
  });
});

/* GET /v1/id-cards/:studentId — admin reads a card (scoped) */
router.get("/:studentId", requireAdminPanel, async (req: Request, res: Response) => {
  const studentId = String(req.params.studentId);
  if (!UUID_RE.test(studentId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Card not found.");
    return;
  }
  const scope = await resolveAdminScope(req.authUser!);
  const [student] = await db
    .select({ id: students.id, centre_id: students.centre_id })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  if (!student || !inScope(scope, student.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Card not found.");
    return;
  }
  const [card] = await db
    .select({
      student_id: digital_id_cards.student_id,
      card_number: digital_id_cards.card_number,
      png_url: digital_id_cards.png_url,
      qr_payload: digital_id_cards.qr_payload,
      qr_signature: digital_id_cards.qr_signature,
      msv_badge: digital_id_cards.msv_badge,
      version_no: digital_id_cards.version_no,
      is_active: digital_id_cards.is_active,
      generated_at: digital_id_cards.generated_at,
      last_regenerated_at: digital_id_cards.last_regenerated_at,
    })
    .from(digital_id_cards)
    .where(eq(digital_id_cards.student_id, studentId))
    .limit(1);
  if (!card) {
    fail(res, 404, "ERR_NOT_FOUND", "Card not found.");
    return;
  }
  ok(res, {
    ...card,
    png_url: signUploadUrl(card.png_url),
    generated_at: card.generated_at ? card.generated_at.toISOString() : null,
    last_regenerated_at: card.last_regenerated_at ? card.last_regenerated_at.toISOString() : null,
  });
});

export default router;
