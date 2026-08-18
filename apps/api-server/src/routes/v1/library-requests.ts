/**
 * /v1/library/requests — user-submitted "please add this content" requests.
 * Section 17 v3 §17.10.
 *
 * OPEN TO GUESTS BY DESIGN. Submission is an action, not content, so no access
 * tier applies and there is deliberately no `requires_login` concept anywhere
 * in this file (CLAUDE.md Q13). A signed-out visitor gets the same form and the
 * same 201; they are identified by the device id they already use for login.
 *
 * Mounted ahead of the authenticated /v1/library router — see routes/v1.ts.
 *
 * Online-only (§17.4): these writes are NOT part of the offline MMKV queue. A
 * request the admin never receives is worse than a form that says "you need to
 * be online", and unlike an attendance roster there is no work to lose.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  library_content_requests,
  library_sections,
  type NewLibraryContentRequest,
} from "@workspace/db";
import {
  LIBRARY_REQUEST_LIMITS,
  contactPhoneToE164,
  libraryContentRequestCreateSchema,
} from "@workspace/api-zod";
import { ok, fail } from "../../lib/envelope";
import { optionalAuth } from "../../middlewares/auth";
import { rateLimit } from "../../lib/ratelimit";
import { zodDetails } from "../../lib/panchang-schema";
import { clampLimit } from "../../lib/route-helpers";
import {
  overPendingLimit,
  requesterRateKey,
  requesterScope,
  resolveRequester,
} from "../../lib/library-requests";

const router: IRouter = Router();
router.use(optionalAuth);

/** POST /v1/library/requests — submit a content request (members and guests). */
router.post("/", async (req: Request, res: Response) => {
  let body: z.infer<typeof libraryContentRequestCreateSchema>;
  try {
    body = libraryContentRequestCreateSchema.parse(req.body);
  } catch (err) {
    const details = err instanceof z.ZodError ? zodDetails(err) : undefined;
    fail(res, 422, "ERR_VALIDATION_FAILED", "Check the highlighted fields and try again.", details);
    return;
  }

  const requester = resolveRequester(req, body.requester_device_id ?? null);
  if (!requester) {
    // A guest with no device id cannot be given a "My requests" list later, and
    // could not be rate-limited as an individual. Ask for it rather than
    // writing an unattributable row.
    fail(
      res,
      422,
      "ERR_VALIDATION_FAILED",
      "We could not identify this device — reopen the app and try again, or sign in to send your request.",
    );
    return;
  }

  // Name and phone: on the profile for a member, mandatory from a guest.
  const user = req.authUser;
  const requesterName = body.requester_name ?? user?.full_name ?? null;
  const requesterPhoneRaw = body.requester_phone ?? user?.phone ?? null;
  if (!requesterName || !requesterPhoneRaw) {
    fail(
      res,
      422,
      "ERR_VALIDATION_FAILED",
      "Add your name and mobile number so we can tell you when this is added.",
    );
    return;
  }

  // §17.10.6 — per-requester first, then per-IP. Ordered and short-circuited
  // like the OTP limiter so a caller already over their own cap does not also
  // burn a slot in the shared IP bucket.
  const overLimit =
    (await rateLimit(
      `library:request:requester:${requesterRateKey(requester)}`,
      LIBRARY_REQUEST_LIMITS.perRequesterPerDay,
      LIBRARY_REQUEST_LIMITS.windowSeconds,
    )) ||
    (await rateLimit(
      `library:request:ip:${req.ip ?? "unknown"}`,
      LIBRARY_REQUEST_LIMITS.perIpPerDay,
      LIBRARY_REQUEST_LIMITS.windowSeconds,
    ));
  if (overLimit) {
    fail(
      res,
      429,
      "ERR_LIBRARY_REQUEST_RATE_LIMITED",
      "You have sent all the content requests allowed for today — try again tomorrow, or add detail to a request you already sent.",
    );
    return;
  }

  if (await overPendingLimit(requester)) {
    fail(
      res,
      409,
      "ERR_LIBRARY_REQUEST_PENDING_LIMIT",
      "Your earlier requests are still waiting for review — wait for one to be answered before sending another.",
    );
    return;
  }

  // A request may only target a section the requester can actually see.
  // Accepting an unpublished or deleted id would let the picker be probed for
  // sections that are not public yet.
  if (body.section_id) {
    const [section] = await db
      .select({ id: library_sections.id })
      .from(library_sections)
      .where(
        and(
          eq(library_sections.id, body.section_id),
          eq(library_sections.is_published, true),
          isNull(library_sections.deleted_at),
        ),
      )
      .limit(1);
    if (!section) {
      fail(res, 404, "ERR_NOT_FOUND", "That library section is no longer available — pick another one.");
      return;
    }
  }

  const values: NewLibraryContentRequest = {
    section_id: body.section_id ?? null,
    suggested_section: body.suggested_section ?? null,
    title: body.title,
    details: body.details,
    reference_url: body.reference_url ?? null,
    requester_user_id: requester.userId,
    requester_device_id: requester.deviceId,
    requester_name: requesterName,
    requester_phone: contactPhoneToE164(requesterPhoneRaw),
    status: "pending",
  };

  const [row] = await db.insert(library_content_requests).values(values).returning({
    id: library_content_requests.id,
    status: library_content_requests.status,
    created_at: library_content_requests.created_at,
  });

  ok(res, { request: { id: row!.id, status: row!.status, created_at: row!.created_at } }, undefined, 201);
});

/**
 * GET /v1/library/requests/mine — the caller's own requests, newest first.
 *
 * Scoped by user id when signed in, else by device id. After the first login
 * re-key a member sees their guest history here too, which is the whole point
 * of keeping the device id on the row.
 */
router.get("/mine", async (req: Request, res: Response) => {
  const requester = resolveRequester(req, null);
  if (!requester) {
    // Not an error: a caller we cannot identify simply has no requests.
    ok(res, { requests: [] }, { count: 0 });
    return;
  }
  const limit = clampLimit(req.query.limit, 50, 100);
  const rows = await db
    .select({
      id: library_content_requests.id,
      section_id: library_content_requests.section_id,
      section_name_en: library_sections.name_en,
      section_name_hi: library_sections.name_hi,
      suggested_section: library_content_requests.suggested_section,
      title: library_content_requests.title,
      details: library_content_requests.details,
      reference_url: library_content_requests.reference_url,
      status: library_content_requests.status,
      admin_note: library_content_requests.admin_note,
      linked_item_id: library_content_requests.linked_item_id,
      created_at: library_content_requests.created_at,
      actioned_at: library_content_requests.actioned_at,
    })
    .from(library_content_requests)
    .leftJoin(library_sections, eq(library_sections.id, library_content_requests.section_id))
    .where(requesterScope(requester))
    .orderBy(desc(library_content_requests.created_at))
    .limit(limit);

  ok(res, { requests: rows }, { count: rows.length });
});

export default router;
