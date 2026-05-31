/**
 * /v1 router — public and admin API surface
 *
 * Proxies to INTERNAL_API_BASE_URL when set (real backend).
 * Returns 503 in local dev without the backend so callers get a clear error.
 *
 * Express 5 / path-to-regexp v8: use explicit named params, no glob wildcards.
 */
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

const INTERNAL_API_BASE = process.env.INTERNAL_API_BASE_URL;

async function proxy(req: Request, res: Response, upstreamPath: string): Promise<void> {
  if (!INTERNAL_API_BASE) {
    res.status(503).json({
      error: {
        code: "ERR_BACKEND_UNAVAILABLE",
        message: "Backend API not configured. Set INTERNAL_API_BASE_URL.",
      },
    });
    return;
  }

  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const url = `${INTERNAL_API_BASE}${upstreamPath}${qs}`;
  const headers: Record<string, string> = { Accept: "application/json" };

  // Mobile clients send a bearer token via the Authorization header (no cookies);
  // the web client relies on the jp_access cookie. Honor the header first, then
  // fall back to the cookie so existing web behavior is unchanged.
  const incomingAuth = req.headers.authorization;
  const cookieAuth = (req.cookies as Record<string, string> | undefined)?.jp_access;
  if (incomingAuth) {
    headers["Authorization"] = incomingAuth;
  } else if (cookieAuth) {
    headers["Authorization"] = `Bearer ${cookieAuth}`;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    headers["Content-Type"] = "application/json";
  }

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
    });
    const data = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(data);
  } catch {
    res.status(503).json({
      error: { code: "ERR_UPSTREAM", message: "Upstream backend unreachable." },
    });
  }
}

function makeProxyHandler(prefix: string) {
  return (req: Request, res: Response) => {
    proxy(req, res, `/v1/${prefix}${req.path}`);
  };
}

router.use("/public", makeProxyHandler("public"));
router.use("/admin", makeProxyHandler("admin"));
router.use("/auth", makeProxyHandler("auth"));
router.use("/notices", makeProxyHandler("notices"));
router.use("/gallery", makeProxyHandler("gallery"));

export default router;
