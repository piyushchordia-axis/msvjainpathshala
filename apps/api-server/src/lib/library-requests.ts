/**
 * Library content requests — requester identity, abuse caps, and the
 * device→account re-key. Section 17 v3 §17.10.
 *
 * The route layer stays thin because two of these rules have to hold on paths
 * that are not the request handler: the re-key runs inside the login flow, and
 * the pending cap has to see re-keyed history as belonging to the same person.
 */
import type { Request } from "express";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, library_content_requests } from "@workspace/db";
import { LIBRARY_REQUEST_LIMITS } from "@workspace/api-zod";
import { logger } from "./logger";

/**
 * Who is asking. Exactly one of these is set on any row we write, and the
 * `library_content_requests_requester_check` CHECK enforces that at the
 * database too.
 */
export type Requester =
  | { kind: "user"; userId: string; deviceId: string | null }
  | { kind: "device"; userId: null; deviceId: string };

/**
 * The pre-login device identifier.
 *
 * The same value the client already mints for `POST /api/auth/login` (verify
 * phase) and stores at `jp.mobile.device_id` / `jp.web.device_id` — NOT a new
 * identifier. Using anything else would mean a guest's requests never re-key to
 * their account on first login, because the login flow only ever sees this one.
 *
 * Accepted from the body, the `X-Device-Id` header, or a `device_id` query
 * param. GET /mine has no body to put it in, and the clients' shared `apiGet`
 * takes a path and nothing else — so a GET carries it in the query string
 * rather than forcing a per-call header argument through every caller.
 */
export function deviceIdFromRequest(req: Request, fromBody?: string | null): string | null {
  const header = req.headers["x-device-id"];
  const headerRaw = Array.isArray(header) ? header[0] : header;
  const queryRaw = req.query?.device_id;
  const candidate =
    fromBody ?? (typeof headerRaw === "string" ? headerRaw : null) ??
    (typeof queryRaw === "string" ? queryRaw : null);
  const trimmed = typeof candidate === "string" ? candidate.trim() : "";
  if (!trimmed || trimmed.length > 128) return null;
  return trimmed;
}

/**
 * Resolve the caller. A signed-in caller is always identified by their user id
 * even when the client also sends a device id — otherwise a member's requests
 * would split across two identities and the pending cap would count neither
 * half correctly.
 */
export function resolveRequester(req: Request, bodyDeviceId?: string | null): Requester | null {
  const userId = req.authUser?.id;
  if (userId) {
    return { kind: "user", userId, deviceId: deviceIdFromRequest(req, bodyDeviceId) };
  }
  const deviceId = deviceIdFromRequest(req, bodyDeviceId);
  if (!deviceId) return null;
  return { kind: "device", userId: null, deviceId };
}

/** The rate-limit subject: one bucket per person, whichever way they are known. */
export function requesterRateKey(requester: Requester): string {
  return requester.kind === "user" ? `user:${requester.userId}` : `device:${requester.deviceId}`;
}

/**
 * Match every row belonging to this requester.
 *
 * A guest matches on device id, but only rows NOT yet claimed by an account.
 * On a shared family handset one parent signs in and their requests re-key to
 * them; without the `requester_user_id IS NULL` guard the next person to open
 * the app on that phone — signed in or not — would read the first person's
 * requests, name and all, out of "My requests".
 *
 * For a signed-in caller the device id is ORed in for the same reason it is
 * kept on the row: requests made as a guest minutes ago in this same session
 * are re-keyed at login, but a caller who has not re-authenticated since would
 * otherwise see their pending allowance silently reset.
 */
function requesterFilter(requester: Requester) {
  const unclaimedOnThisDevice = (deviceId: string) =>
    and(
      eq(library_content_requests.requester_device_id, deviceId),
      isNull(library_content_requests.requester_user_id),
    );

  if (requester.kind === "device") {
    return unclaimedOnThisDevice(requester.deviceId);
  }
  const byUser = eq(library_content_requests.requester_user_id, requester.userId);
  if (!requester.deviceId) return byUser;
  return or(byUser, unclaimedOnThisDevice(requester.deviceId));
}

/** §17.10.6 — how many requests this requester currently holds in `pending`. */
export async function pendingRequestCount(requester: Requester): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(library_content_requests)
    .where(and(eq(library_content_requests.status, "pending"), requesterFilter(requester)));
  return row?.n ?? 0;
}

/** True when a further submission would exceed the pending cap. */
export async function overPendingLimit(requester: Requester): Promise<boolean> {
  return (await pendingRequestCount(requester)) >= LIBRARY_REQUEST_LIMITS.maxPending;
}

/** Rows for GET /v1/library/requests/mine, newest first. */
export function requesterScope(requester: Requester) {
  return requesterFilter(requester);
}

/**
 * First-login re-key (§17.10.2): stamp `requester_user_id` on every request
 * this device made while signed out, so the requester's history and their
 * publish notifications survive the transition from guest to member.
 *
 * `requester_device_id` is deliberately KEPT. It is the provenance of the row
 * and the only thing that makes this operation idempotent; clearing it would
 * also momentarily violate the requester CHECK.
 *
 * Never throws. This runs on the login path, and a failure to re-key a content
 * request must not cost anyone their sign-in — the rows stay device-scoped and
 * the next login picks them up.
 */
export async function rekeyDeviceRequestsToUser(userId: string, deviceId: string): Promise<number> {
  if (!deviceId) return 0;
  try {
    const rows = await db
      .update(library_content_requests)
      .set({ requester_user_id: userId, updated_at: new Date() })
      .where(
        and(
          eq(library_content_requests.requester_device_id, deviceId),
          isNull(library_content_requests.requester_user_id),
        ),
      )
      .returning({ id: library_content_requests.id });
    if (rows.length > 0) {
      logger.info(
        { user_id: userId, device_id: deviceId, count: rows.length },
        "[library-requests] re-keyed device-scoped content requests to account",
      );
    }
    return rows.length;
  } catch (err) {
    logger.error(
      { err, user_id: userId, device_id: deviceId },
      "[library-requests] re-key failed; requests remain device-scoped",
    );
    return 0;
  }
}
