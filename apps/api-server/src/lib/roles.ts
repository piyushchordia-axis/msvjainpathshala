/**
 * Role hierarchy helpers — route table roles are MINIMUMS; higher roles inherit.
 */
import type { NextFunction, Request, Response } from "express";
import type { Role } from "@workspace/api-zod";
import { fail } from "./envelope";

/** Higher number = more privilege (CLAUDE.md eight-role ladder). */
const ROLE_RANK: Record<Role, number> = {
  super_admin: 8,
  state_admin: 7,
  city_admin: 6,
  sanchalak: 5,
  shikshak: 4,
  parent: 3,
  student: 2,
  guest: 1,
};

export function roleRank(role: Role | string | null | undefined): number {
  if (!role) return 0;
  return ROLE_RANK[role as Role] ?? 0;
}

/** True when `role` is at least as privileged as `minimum`. */
export function hasMinRole(
  role: Role | string | null | undefined,
  minimum: Role,
): boolean {
  return roleRank(role) >= roleRank(minimum);
}

/** Express middleware: caller must meet the minimum role (or higher). */
export function requireMinRole(minimum: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.authUser?.role as Role | undefined;
    if (!hasMinRole(role, minimum)) {
      fail(res, 403, "ERR_FORBIDDEN", "You do not have access to this resource.");
      return;
    }
    next();
  };
}
