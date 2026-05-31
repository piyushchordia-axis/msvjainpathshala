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

export function clearAuthCookies(res: Response): void {
  for (const name of ["jp_access", "jp_refresh", "jp_user", "jp_imp_active", "jp_imp_origin_name"]) {
    res.clearCookie(name, { path: "/" });
  }
}
