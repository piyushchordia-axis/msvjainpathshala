import type { NextFunction, Request, Response } from "express";
import type { User } from "@workspace/db";
import { canAccessAdminPanel, type Role } from "@workspace/api-zod";
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
