import path from "node:path";
import express, { type Express, type Request } from "express";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import v1Router from "./routes/v1";
import legalRouter from "./routes/legal";
import { logger } from "./lib/logger";
import { storage } from "./lib/storage";
import { verifyUploadAccess } from "./lib/file-tokens";
import { MIME_BY_EXT } from "./lib/upload";
import { fail } from "./lib/envelope";
import { handleMulterError } from "./middlewares/multer-error";
import { corsOriginDelegate } from "./lib/cors-origins";

const isProd = process.env.NODE_ENV === "production";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Raw request body bytes, captured for payment webhook signature checks. */
      rawBody?: Buffer;
    }
  }
}

const app: Express = express();

// Behind a single reverse proxy (nginx) in production, trust the first hop so
// req.ip / req.protocol reflect the real client (the auth rate-limiter keys on
// req.ip and signed-upload links honour X-Forwarded-Proto). One hop only — do
// not trust an arbitrary chain.
if (isProd) app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(compression());
app.use(
  cors({
    credentials: true,
    origin: corsOriginDelegate,
    maxAge: 86_400,
  }),
);
// Baseline security response headers (helmet-equivalent, dependency-free).
// X-Content-Type-Options is important for the /uploads static route so a
// MIME-spoofed upload cannot be sniffed+executed as HTML/JS.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  // HSTS only in production (behind HTTPS at the nginx hop). Skipped in dev so
  // plain-HTTP localhost previews aren't pinned to https.
  if (isProd) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  // Content-Security-Policy is deliberately deferred: a strict CSP can break the
  // same-origin admin SPA and needs per-app QA before we enable it.
  next();
});
app.use(cookieParser());
app.use(
  express.json({
    limit: "2mb",
    verify: (req: Request, _res, buf) => {
      // Stash raw bytes so payment webhooks can verify HMAC signatures.
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files ONLY with a valid short-lived signature (see
// lib/file-tokens.ts). Sensitive artifacts (progress PDFs, ID cards, proofs)
// are no longer world-readable by URL. API responses mint signed URLs.
// Content-Type comes from MIME_BY_EXT (same table as the upload allowlist).
app.get(/^\/uploads\/.+/, (req: Request, res) => {
  let key: string;
  try {
    key = req.path.replace(/^\/uploads\//, "").split("/").map(decodeURIComponent).join("/");
  } catch {
    res.status(400).end();
    return;
  }
  const se = typeof req.query.se === "string" ? req.query.se : "";
  const sig = typeof req.query.sig === "string" ? req.query.sig : "";
  if (!verifyUploadAccess(key, se, sig)) {
    fail(res, 403, "ERR_FORBIDDEN", "Invalid or expired file link.");
    return;
  }
  const dot = key.lastIndexOf(".");
  const ext = dot >= 0 ? key.slice(dot + 1).toLowerCase() : "";
  res.setHeader("Content-Type", MIME_BY_EXT[ext] ?? "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=3600");
  let stream;
  try {
    stream = storage.getStream(key);
  } catch {
    res.status(404).end();
    return;
  }
  stream.on("error", () => {
    if (!res.headersSent) res.status(404).end();
    else res.destroy();
  });
  stream.pipe(res);
});

// Admin web SPA (apps/jain-pathshala, built with BASE_PATH=/admin/). Served
// same-origin so its relative /api + /v1 calls and HttpOnly auth cookies just
// work. Hashed Vite assets: long immutable cache. index.html: no-cache so
// clients always pick up a new shell that points at fresh hashed chunks.
const ADMIN_WEB_DIR =
  process.env["ADMIN_WEB_DIR"] ?? path.join(process.cwd(), "admin-web");
app.use(
  "/admin",
  express.static(ADMIN_WEB_DIR, {
    maxAge: "1y",
    immutable: true,
    index: false,
  }),
);
app.get(/^\/admin(?:\/.*)?$/, (_req: Request, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(ADMIN_WEB_DIR, "index.html"));
});

// PERF #18 — short public-route cache (marketing first paint).
app.use("/v1/public", (_req, res, next) => {
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  next();
});

app.use("/api", router);
app.use("/v1", v1Router);
// Public legal pages (privacy policy / terms) — required live URLs for the app stores.
app.use(legalRouter);

// Multer LIMIT_* → typed envelope (413/422) before the generic 500 handler.
app.use(handleMulterError);

// Terminal error handler: never leak stack traces / internal errors to clients.
// Express 5 forwards rejected async handlers here. Logs the full error, returns
// the standard envelope.
app.use((err: unknown, req: Request, res: import("express").Response, _next: import("express").NextFunction) => {
  (req as Request & { log?: { error: (o: unknown, m: string) => void } }).log?.error?.({ err }, "unhandled error");
  if (res.headersSent) return;
  fail(res, 500, "ERR_INTERNAL", "Something went wrong.");
});

export default app;
