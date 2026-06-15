import type { Response } from "express";
import type { SessionUser } from "@workspace/api-zod";

const isProd = process.env.NODE_ENV === "production";

function base(expires: Date) {
  return {
    secure: isProd,
    sameSite: "lax" as const,
    expires,
    path: "/",
  };
}

export function setAuthCookies(
  res: Response,
  user: SessionUser,
  accessToken: string,
  accessExpires: Date,
  refreshToken: string,
  refreshExpires: Date,
): void {
  res.cookie("jp_access", accessToken, { ...base(accessExpires), httpOnly: true });
  res.cookie("jp_refresh", refreshToken, { ...base(refreshExpires), httpOnly: true });
  res.cookie("jp_user", JSON.stringify(user), { ...base(refreshExpires), httpOnly: false });
}

/**
 * Mark the current session as an active impersonation. The auth cookies
 * (jp_access/jp_refresh/jp_user) must already point at the impersonated subject
 * — these two flags are read client-side (HttpOnly: false) by AdminLayout to
 * render the ImpersonationBanner. They expire with the session's refresh cookie
 * and are cleared by clearAuthCookies on stop / logout.
 */
export function setImpersonationCookies(res: Response, originName: string, expires: Date): void {
  res.cookie("jp_imp_active", "true", { ...base(expires), httpOnly: false });
  res.cookie("jp_imp_origin_name", originName, { ...base(expires), httpOnly: false });
}

export function clearAuthCookies(res: Response): void {
  for (const name of ["jp_access", "jp_refresh", "jp_user", "jp_imp_active", "jp_imp_origin_name"]) {
    res.clearCookie(name, { path: "/" });
  }
}
