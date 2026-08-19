import type { NextFunction, Request, Response } from "express";
import type { User } from "@workspace/db";
import {
  canAccessAdminPanel,
  canAdministerShivirs,
  canOperateShivirs,
  canViewDonations,
  type Role,
} from "@workspace/api-zod";
import { verifyAccessToken } from "../lib/tokens";
import { fail } from "../lib/envelope";
import { loadAuthUser } from "../lib/auth-user-cache";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: User;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7);
  const cookie = (req.cookies as Record<string, string> | undefined)?.jp_access;
  return cookie ?? null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    fail(res, 401, "ERR_UNAUTHENTICATED", "Authentication required.");
    return;
  }
  const verified = verifyAccessToken(token);
  if (!verified) {
    fail(res, 401, "ERR_TOKEN_INVALID", "Session expired or invalid. Please sign in again.");
    return;
  }
  const user = await loadAuthUser(verified.uid);
  if (!user || !user.is_active || user.deleted_at) {
    fail(res, 401, "ERR_USER_INACTIVE", "Account is not active.");
    return;
  }
  req.authUser = user as User;
  next();
}

/**
 * Attach `req.authUser` when a valid token is present; otherwise continue as a
 * guest. NEVER fails the request — an expired or malformed token is treated
 * exactly like no token at all.
 *
 * For surfaces open to guests by design (Q13: submission is an action, not
 * content — no tier applies, and no `requires_login` concept exists). A guest
 * whose token happens to have expired must not be handed a 401 on a form that
 * signed-out visitors are explicitly allowed to use.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    next();
    return;
  }
  const verified = verifyAccessToken(token);
  if (!verified) {
    next();
    return;
  }
  const user = await loadAuthUser(verified.uid);
  if (user && user.is_active && !user.deleted_at) {
    req.authUser = user as User;
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.authUser?.role as Role | undefined;
    if (!role || !roles.includes(role)) {
      fail(res, 403, "ERR_FORBIDDEN", "You do not have access to this resource.");
      return;
    }
    next();
  };
}

export function requireAdminPanel(req: Request, res: Response, next: NextFunction): void {
  const role = req.authUser?.role as Role | undefined;
  if (!canAccessAdminPanel(role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Admin panel access required.");
    return;
  }
  next();
}

/**
 * Donor PII (name, phone, PAN, amounts). Gated on the shared `canViewDonations`
 * roster rather than an inline role list, so the donation routes and the
 * analytics overview cannot drift apart (XC-API-01).
 */
export function requireDonationView(req: Request, res: Response, next: NextFunction): void {
  const role = req.authUser?.role as Role | undefined;
  if (!canViewDonations(role)) {
    fail(res, 403, "ERR_FORBIDDEN", "You do not have access to donation records.");
    return;
  }
  next();
}

/**
 * Running a shivir: sessions, volunteer assignment, the live dashboard.
 *
 * Narrower than requireAdminPanel — shikshak is excluded (SPEC 6.14). A Guruji
 * reaches a shivir through a volunteer assignment, not through their teaching
 * role, so that every scan traces to someone deliberately put on that shivir.
 */
export function requireShivirOps(req: Request, res: Response, next: NextFunction): void {
  const role = req.authUser?.role as Role | undefined;
  if (!canOperateShivirs(role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only a sanchalak or city admin can manage a shivir.");
    return;
  }
  next();
}

/** Authoring a shivir: create, edit, unpublish, delete, export (SPEC 6.14). */
export function requireShivirAdmin(req: Request, res: Response, next: NextFunction): void {
  const role = req.authUser?.role as Role | undefined;
  if (!canAdministerShivirs(role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only national, state or city admins can manage shivirs.");
    return;
  }
  next();
}
