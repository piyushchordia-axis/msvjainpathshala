/**
 * Role -> persona routing. Each role lands on its own tab group living under a
 * real path segment (parent/, student/, shikshak/, admin/, guest/) so screens
 * with the same name never collide across personas.
 */
import type { Href } from "expo-router";
import type { Role } from "@workspace/api-zod";

/** The home route a freshly-authenticated user of this role should land on. */
export function routeForRole(role: Role | null | undefined): Href {
  switch (role) {
    case "parent":
      return "/parent/home";
    case "student":
      return "/student/home";
    case "shikshak":
      return "/shikshak/today";
    case "super_admin":
    case "state_admin":
    case "city_admin":
    case "sanchalak":
      return "/admin/dashboard";
    default:
      return "/guest/home";
  }
}

/** Whether a role is permitted into a given persona group. */
export function roleAllowed(role: Role | null | undefined, allowed: Role[]): boolean {
  return !!role && allowed.includes(role);
}

export const ADMIN_ROLES: Role[] = ["super_admin", "state_admin", "city_admin", "sanchalak"];
