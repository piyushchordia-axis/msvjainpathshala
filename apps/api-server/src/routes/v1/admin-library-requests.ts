/**
 * /v1/admin/library/requests — the content-request review queue.
 * Section 17 v3 §17.10.4–§17.10.5.
 *
 * Mounted under the admin library router, which already requires city_admin —
 * that is the READ gate. The act gate (state_admin and above) is enforced in
 * the SERVICE layer, not here: a city_admin calling PATCH directly must get a
 * 403, and a middleware could not express that split without over-gating the
 * queue they are entitled to read.
 *
 * Every action writes an audit entry.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { auditFromReq } from "../../lib/audit";
import { clampLimit } from "../../lib/route-helpers";
import { isUuid } from "../../lib/validation";
import { zodDetails } from "../../lib/panchang-schema";
import {
  LibraryRequestForbiddenError,
  LibraryRequestTransitionError,
  canActOnRequests,
  createItemFromRequest,
  decideRequest,
  getRequest,
  listRequestQueue,
  requesterAccountNames,
  similarPendingRequests,
} from "../../lib/library-requests-admin";

const router: IRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const queueQuerySchema = z.object({
  status: z.enum(["pending", "accepted", "rejected", "published"]).optional(),
  section_id: z.string().uuid().optional(),
  from: z.string().regex(DATE_RE).optional(),
  to: z.string().regex(DATE_RE).optional(),
});

/** Map the service's typed failures onto the envelope. */
function failFromServiceError(res: Response, err: unknown): boolean {
  if (err instanceof LibraryRequestForbiddenError) {
    fail(
      res,
      403,
      "ERR_LIBRARY_REQUEST_ACTION_FORBIDDEN",
      "Only a state or national admin can accept or reject content requests — you can read the queue and pass this one on.",
    );
    return true;
  }
  if (err instanceof LibraryRequestTransitionError) {
    fail(res, 409, "ERR_INVALID_TRANSITION", err.message);
    return true;
  }
  return false;
}

/** GET /v1/admin/library/requests — filtered, paginated queue. */
router.get("/", async (req: Request, res: Response) => {
  const parsed = queueQuerySchema.safeParse({
    status: req.query.status || undefined,
    section_id: req.query.section_id || undefined,
    from: req.query.from || undefined,
    to: req.query.to || undefined,
  });
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Check the filters and try again.", zodDetails(parsed.error));
    return;
  }
  const limit = clampLimit(req.query.limit, 25, 100);
  const offsetRaw = Number(req.query.offset);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

  const { rows, total } = await listRequestQueue({
    status: parsed.data.status ?? null,
    sectionId: parsed.data.section_id ?? null,
    from: parsed.data.from ?? null,
    to: parsed.data.to ?? null,
    limit,
    offset,
  });

  // Whether the caller may act travels with the payload so the UI can hide
  // buttons it must not offer — supplementing the service check, never
  // replacing it (§17.10.5).
  ok(
    res,
    { requests: rows, can_act: canActOnRequests(req.authUser?.role) },
    { count: rows.length, total, has_more: offset + rows.length < total, next_offset: offset + limit },
  );
});

/** GET /v1/admin/library/requests/:id — detail plus duplicate asks. */
router.get("/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isUuid(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "That content request could not be found.");
    return;
  }
  const request = await getRequest(id);
  if (!request) {
    fail(res, 404, "ERR_NOT_FOUND", "That content request could not be found.");
    return;
  }
  const [similar, names] = await Promise.all([
    similarPendingRequests(request),
    requesterAccountNames([request.requester_user_id]),
  ]);
  ok(res, {
    request: {
      ...request,
      requester_account_name: request.requester_user_id
        ? (names.get(request.requester_user_id) ?? null)
        : null,
    },
    similar_pending: similar,
    can_act: canActOnRequests(req.authUser?.role),
  });
});

const decideSchema = z.object({
  action: z.enum(["accept", "reject"]),
  admin_note: z.string().trim().max(2000).nullable().optional(),
});

/** PATCH /v1/admin/library/requests/:id — accept or reject. */
router.patch("/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isUuid(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "That content request could not be found.");
    return;
  }
  const parsed = decideSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(
      res,
      422,
      "ERR_VALIDATION_FAILED",
      "Say whether to accept or reject, and try again.",
      zodDetails(parsed.error),
    );
    return;
  }
  const to = parsed.data.action === "accept" ? "accepted" : "rejected";

  try {
    const updated = await decideRequest({
      id,
      to,
      adminNote: parsed.data.admin_note,
      actorId: req.authUser!.id,
      actorRole: req.authUser?.role,
    });
    if (!updated) {
      fail(res, 404, "ERR_NOT_FOUND", "That content request could not be found.");
      return;
    }
    await auditFromReq(req, {
      action: parsed.data.action === "accept" ? "approve" : "reject",
      entityKind: "library_content_request",
      entityId: updated.id,
      summary: `Library content request ${to}: "${updated.title}".`,
      // The note reaches the requester, so what they were told belongs in the
      // trail. Never the phone — that is PII and already on the row.
      metadata: { status: to, admin_note: updated.admin_note ?? null },
    });
    ok(res, { request: updated });
  } catch (err) {
    if (failFromServiceError(res, err)) return;
    throw err;
  }
});

/** POST /v1/admin/library/requests/:id/create-item — spawn a prefilled draft. */
router.post("/:id/create-item", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isUuid(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "That content request could not be found.");
    return;
  }
  try {
    const created = await createItemFromRequest({
      id,
      actorId: req.authUser!.id,
      actorRole: req.authUser?.role,
    });
    if (!created) {
      fail(res, 404, "ERR_NOT_FOUND", "That content request could not be found.");
      return;
    }
    await auditFromReq(req, {
      action: "create",
      entityKind: "library_item",
      entityId: created.itemId,
      summary: `Library item draft created from content request (${created.itemCode}).`,
      metadata: { request_id: created.request.id, item_code: created.itemCode },
    });
    ok(res, { request: created.request, item_id: created.itemId, item_code: created.itemCode });
  } catch (err) {
    if (failFromServiceError(res, err)) return;
    throw err;
  }
});

export default router;
