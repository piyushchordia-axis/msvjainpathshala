/**
 * /v1/id-cards — Digital ID cards (QR + PNG).
 *
 * Admins (panel) generate/regenerate a signed, scannable ID card for a student
 * in their centre scope and read it back. The owning parent/student reads their
 * own card via /mine. A signed QR payload can be verified by any authed caller
 * (shivir scanner / shikshak) via /verify using a constant-time HMAC check.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { db, digital_id_cards, students, centres } from "@workspace/db";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, type AdminScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import { storage, makeKey } from "../../lib/storage";
import { signUploadUrl, uploadKeyFromUrl } from "../../lib/file-tokens";
import { qrDataUrl, svgToPng } from "../../lib/qr";

const router: IRouter = Router();
router.use(requireAuth);

const SECRET = process.env["JP_AUTH_SECRET"] ?? "jp-dev-secret-do-not-use-in-production";

/**
 * Domain-separated key for QR HMACs, derived once from the auth-token secret so
 * that signing/verifying ID-card QRs never shares a key with auth tokens.
 */
const QR_SECRET = createHmac("sha256", SECRET).update("id-card-qr-v1").digest();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hex length of an HMAC-SHA256 signature (32 bytes -> 64 hex chars). */
const SIGNATURE_HEX_LEN = 64;

/* ---- local helper copy-pasted into admin route files ---- */
function inScope(scope: AdminScope, centreId: string | null): boolean {
  if (scope.centreIds === null) return true;
  if (!centreId) return false;
  return scope.centreIds.includes(centreId);
}

/** Build the canonical signed payload string and its HMAC-SHA256 signature. */
function signPayload(studentId: string, cardNumber: string, versionNo: number) {
  const qr_payload = JSON.stringify({ student_id: studentId, card_number: cardNumber, v: versionNo });
  const qr_signature = createHmac("sha256", QR_SECRET).update(qr_payload).digest("hex");
  return { qr_payload, qr_signature };
}

/** Constant-time hex-string comparison; false on any length/format mismatch. */
function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  // Reject non-canonical signatures before decoding: Buffer.from(hex) silently
  // truncates at the first non-hex char, so junk appended to a valid signature
  // would otherwise decode to the same bytes. Require pure-hex of exact length.
  if (
    a.length !== SIGNATURE_HEX_LEN ||
    b.length !== SIGNATURE_HEX_LEN ||
    !/^[0-9a-f]+$/i.test(a) ||
    !/^[0-9a-f]+$/i.test(b)
  ) {
    return false;
  }
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Compose the ~600x380 SVG ID card, embedding the signed QR as a data-URL image. */
function buildCardSvg(opts: {
  fullName: string;
  studentCode: string;
  centreName: string;
  cardNumber: string;
  msvBadge: boolean;
  qrImage: string;
}): string {
  const { fullName, studentCode, centreName, cardNumber, msvBadge, qrImage } = opts;
  const badge = msvBadge
    ? `<g>
         <rect x="40" y="300" width="150" height="34" rx="17" fill="#16a34a" />
         <text x="115" y="322" font-family="Arial, sans-serif" font-size="15" font-weight="bold" fill="#ffffff" text-anchor="middle">MSV MEMBER</text>
       </g>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="380" viewBox="0 0 600 380">
  <rect x="0" y="0" width="600" height="380" rx="18" fill="#ffffff" stroke="#e5e7eb" stroke-width="2" />
  <rect x="0" y="0" width="600" height="70" rx="18" fill="#7c3aed" />
  <rect x="0" y="40" width="600" height="30" fill="#7c3aed" />
  <text x="40" y="46" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="#ffffff">Jain Pathshala</text>
  <text x="40" y="64" font-family="Arial, sans-serif" font-size="13" fill="#ede9fe">Digital ID Card</text>
  <text x="40" y="130" font-family="Arial, sans-serif" font-size="15" fill="#6b7280">Name</text>
  <text x="40" y="158" font-family="Arial, sans-serif" font-size="26" font-weight="bold" fill="#111827">${esc(fullName)}</text>
  <text x="40" y="200" font-family="Arial, sans-serif" font-size="15" fill="#6b7280">Student Code</text>
  <text x="40" y="224" font-family="Arial, sans-serif" font-size="18" fill="#111827">${esc(studentCode)}</text>
  <text x="40" y="258" font-family="Arial, sans-serif" font-size="15" fill="#6b7280">Centre</text>
  <text x="40" y="282" font-family="Arial, sans-serif" font-size="18" fill="#111827">${esc(centreName)}</text>
  ${badge}
  <image x="400" y="120" width="170" height="170" href="${qrImage}" />
  <text x="485" y="306" font-family="Arial, sans-serif" font-size="13" fill="#6b7280" text-anchor="middle">Scan to verify</text>
  <text x="40" y="354" font-family="Arial, sans-serif" font-size="14" fill="#374151">Card No: ${esc(cardNumber)}</text>
</svg>`;
}

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
      .select({ version_no: digital_id_cards.version_no, png_url: digital_id_cards.png_url })
      .from(digital_id_cards)
      .where(eq(digital_id_cards.student_id, studentId))
      .limit(1);

    const versionNo = existing ? existing.version_no + 1 : 1;
    const cardNumber = `MSV-${student.student_code}`;
    const msvBadge = student.msv_status === "approved";
    const { qr_payload, qr_signature } = signPayload(studentId, cardNumber, versionNo);

    const qrImage = await qrDataUrl(qr_payload, 340);
    const svg = buildCardSvg({
      fullName: student.full_name ?? student.student_code,
      studentCode: student.student_code,
      centreName: student.centre_name ?? "—",
      cardNumber,
      msvBadge,
      qrImage,
    });
    const png = await svgToPng(svg);
    const { url } = await storage.put(makeKey("id-cards", `${cardNumber}.png`), png, "image/png");
    // Delete the superseded PNG so stale card images don't linger on disk.
    if (existing?.png_url) {
      const oldKey = uploadKeyFromUrl(existing.png_url);
      if (oldKey) await storage.remove(oldKey);
    }

    const now = new Date();
    const [row] = await db
      .insert(digital_id_cards)
      .values({
        student_id: studentId,
        qr_token: qr_signature.slice(0, 32),
        card_number: cardNumber,
        qr_payload,
        qr_signature,
        png_url: url,
        svg_payload: svg,
        msv_badge: msvBadge,
        version_no: versionNo,
        generated_at: now,
        last_regenerated_at: existing ? now : null,
        is_active: true,
      })
      .onConflictDoUpdate({
        target: digital_id_cards.student_id,
        set: {
          qr_token: qr_signature.slice(0, 32),
          card_number: cardNumber,
          qr_payload,
          qr_signature,
          png_url: url,
          svg_payload: svg,
          msv_badge: msvBadge,
          version_no: versionNo,
          last_regenerated_at: now,
          is_active: true,
        },
      })
      .returning({
        student_id: digital_id_cards.student_id,
        card_number: digital_id_cards.card_number,
        png_url: digital_id_cards.png_url,
        version_no: digital_id_cards.version_no,
      });

    await auditFromReq(req, {
      action: "create",
      entityKind: "digital_id_card",
      entityId: studentId,
      summary: `ID card ${existing ? "regenerated" : "generated"} (${cardNumber}, v${versionNo}).`,
      metadata: { card_number: cardNumber, version_no: versionNo },
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
  const expected = createHmac("sha256", QR_SECRET).update(body.qr_payload).digest("hex");
  if (!safeEqualHex(expected, body.qr_signature)) {
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
