/**
 * /v1/enquiries — public contact / enrolment-enquiry intake plus the admin inbox.
 *
 * POST /v1/enquiries is PUBLIC (no auth): website contact/enquire/donate forms
 * write a 'new' enquiry here. The admin read + status endpoints are gated
 * per-route with requireAuth + requireAdminPanel.
 *
 * Enquiries are submitted BEFORE any account/centre exists, so they have no
 * centre to scope by. They are therefore ORG-WIDE: every admin-panel role sees
 * the full inbox. (No centre scoping is possible or applied here.)
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, enquiries } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { auditFromReq } from "../../lib/audit";

const router: IRouter = Router();

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

const ENQUIRY_KINDS = ["contact", "enquire", "donate"] as const;
const ENQUIRY_STATUSES = ["new", "in_review", "closed"] as const;

// Guard :id route params: a non-UUID passed to eq(<uuid column>, ...) makes
// Postgres throw 22P02 and 500 the request. Match a UUID before any DB call.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ═══════════════════════════ PUBLIC — intake ═══════════════════════════ */

const createEnquirySchema = z.object({
  kind: z.enum(ENQUIRY_KINDS),
  name: z.string().min(1).max(200),
  phone: z.string().max(20).optional(),
  email: z.string().email().max(255).optional(),
  subject: z.string().max(300).optional(),
  message: z.string().min(1).max(5000),
  city: z.string().max(120).optional(),
});

/* POST /v1/enquiries — PUBLIC: submit a contact/enquire/donate message */
router.post("/", async (req: Request, res: Response) => {
  let body: z.infer<typeof createEnquirySchema>;
  try {
    body = createEnquirySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid enquiry data.");
    return;
  }

  const [row] = await db
    .insert(enquiries)
    .values({
      kind: body.kind,
      name: body.name,
      phone: body.phone ?? null,
      email: body.email ?? null,
      subject: body.subject ?? null,
      message: body.message,
      city: body.city ?? null,
      status: "new",
    })
    .returning({ id: enquiries.id, status: enquiries.status });
  ok(res, row);
});

/* ═══════════════════════════ ADMIN — inbox ═══════════════════════════ */
// Per-route admin gate (POST above stays public; everything below is guarded).

const listQuerySchema = z.object({
  kind: z.enum(ENQUIRY_KINDS).optional(),
  status: z.enum(ENQUIRY_STATUSES).optional(),
});

/* GET /v1/enquiries?kind=&status=&limit= — org-wide inbox, newest first */
router.get("/", requireAuth, requireAdminPanel, async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid filter.");
    return;
  }
  const limit = clampLimit(req.query.limit, 100, 300);
  const filters = [];
  if (parsed.data.kind) filters.push(eq(enquiries.kind, parsed.data.kind));
  if (parsed.data.status) filters.push(eq(enquiries.status, parsed.data.status));

  const rows = await db
    .select({
      id: enquiries.id,
      kind: enquiries.kind,
      name: enquiries.name,
      phone: enquiries.phone,
      email: enquiries.email,
      subject: enquiries.subject,
      message: enquiries.message,
      city: enquiries.city,
      status: enquiries.status,
      created_at: enquiries.created_at,
    })
    .from(enquiries)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(enquiries.created_at))
    .limit(limit);

  const items = rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
  ok(res, { items }, { count: items.length });
});

const statusSchema = z.object({
  status: z.enum(["in_review", "closed"]),
});

/* POST /v1/enquiries/:id/status — admin marks an enquiry in_review / closed */
router.post(
  "/:id/status",
  requireAuth,
  requireAdminPanel,
  async (req: Request, res: Response) => {
    let body: z.infer<typeof statusSchema>;
    try {
      body = statusSchema.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid status.");
      return;
    }

    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Enquiry not found.");
      return;
    }

    const [item] = await db
      .select({ id: enquiries.id })
      .from(enquiries)
      .where(eq(enquiries.id, id))
      .limit(1);
    if (!item) {
      fail(res, 404, "ERR_NOT_FOUND", "Enquiry not found.");
      return;
    }

    await db
      .update(enquiries)
      .set({ status: body.status, handled_by: req.authUser!.id, updated_at: new Date() })
      .where(eq(enquiries.id, item.id));

    await auditFromReq(req, {
      action: "update",
      entityKind: "enquiry",
      entityId: item.id,
      summary: `Enquiry marked ${body.status}`,
    });

    ok(res, { id: item.id, status: body.status });
  },
);

export default router;
