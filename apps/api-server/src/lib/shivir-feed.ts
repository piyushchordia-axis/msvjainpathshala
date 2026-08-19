/**
 * Socket.IO `/shivirs/:shivirId` — the live scan feed CLAUDE.md mandates.
 *
 * The admin dashboard was labelled "live" and neither subscribed to anything
 * nor polled: it loaded once per dropdown selection and then only on a manual
 * Refresh. A city_admin watching a shivir saw a frozen number.
 *
 * Unlike the AT31 admin feed, scans are emitted individually rather than as a
 * windowed aggregate. The volume is different in kind — a shivir is hundreds of
 * scans over a day, not 5,000 marks in 60 seconds — and the dashboard's whole
 * purpose is to name the child who just walked in.
 */
import type { Namespace, Socket } from "socket.io";
import type { User } from "@workspace/db";
import { verifyAccessToken } from "./tokens";
import { loadAuthUser } from "./auth-user-cache";
import { assertShivirScanAccess } from "./shivir-access";
import { getIo, onSocketServer } from "./socket-server";
import { logger } from "./logger";

const NAMESPACE_RE = /^\/shivirs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface ShivirScanEvent {
  session_id: string;
  student_id: string;
  scan_kind: "present" | "check_in" | "check_out";
  was_registered: boolean;
  scanned_at: string;
}

/**
 * CLAUDE.md's contract is `auth: { token }`, which the mobile app can satisfy
 * because it holds the access token in memory.
 *
 * The web admin cannot: its token lives in an httpOnly `jp_access` cookie that
 * JavaScript deliberately cannot read. So the cookie is accepted as a third
 * source, exactly as HTTP `requireAuth` already does — otherwise the one client
 * this dashboard exists for could never connect.
 */
export function extractSocketAccessToken(handshake: {
  auth?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}): string | null {
  const fromAuth = handshake.auth?.token;
  if (typeof fromAuth === "string" && fromAuth.length > 0) return fromAuth;
  const header = handshake.headers?.authorization ?? handshake.headers?.Authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7);

  const rawCookie = handshake.headers?.cookie;
  if (typeof rawCookie === "string") {
    for (const part of rawCookie.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === "jp_access" && rest.length > 0) {
        return decodeURIComponent(rest.join("="));
      }
    }
  }
  return null;
}

/**
 * @internal — the join gate, exported for tests.
 *
 * Reuses assertShivirScanAccess, so a volunteer who may scan may watch, and
 * nobody else can. If the HTTP rule ever changes, the socket rule changes with
 * it; there is no second copy to forget.
 */
export async function authenticateShivirSocket(
  namespaceName: string,
  handshake: { auth?: Record<string, unknown>; headers?: Record<string, unknown> },
): Promise<{ user: User; shivirId: string } | { error: string }> {
  const match = NAMESPACE_RE.exec(namespaceName);
  if (!match) return { error: "bad_namespace" };
  const shivirId = match[1]!;

  const token = extractSocketAccessToken(handshake);
  if (!token) return { error: "unauthenticated" };
  const verified = verifyAccessToken(token);
  if (!verified) return { error: "invalid_token" };
  const user = await loadAuthUser(verified.uid);
  if (!user || !user.is_active || user.deleted_at) return { error: "inactive" };

  const access = await assertShivirScanAccess(user as User, shivirId);
  if (!access.ok) return { error: "forbidden" };

  return { user: user as User, shivirId };
}

export function attachShivirFeed(): void {
  onSocketServer((server) => {
    server.of(NAMESPACE_RE).use(async (socket: Socket, next: (err?: Error) => void) => {
      const nsp = (socket.nsp as Namespace).name;
      const result = await authenticateShivirSocket(nsp, socket.handshake);
      if ("error" in result) {
        next(new Error(result.error));
        return;
      }
      socket.data.user = result.user;
      socket.data.shivirId = result.shivirId;
      next();
    });
    logger.info("Socket.IO shivir namespace ready");
  });
}

/**
 * Emit one scan to everyone watching that shivir. Fire-and-forget by design:
 * the scan is already committed and, per AT28, is the only record the child was
 * present — a socket problem must never turn that into a failed scan.
 */
export function emitShivirScan(shivirId: string, event: ShivirScanEvent): void {
  const io = getIo();
  if (!io || !shivirId) return;
  try {
    io.of(`/shivirs/${shivirId}`).emit("shivir.scan", { shivir_id: shivirId, ...event });
  } catch (err) {
    logger.warn({ err, shivirId }, "shivir feed emit failed");
  }
}
