import express, { type Express, type Request } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import v1Router from "./routes/v1";
import { logger } from "./lib/logger";
import { UPLOADS_DIR } from "./lib/storage";
import { fail } from "./lib/envelope";

const isProd = process.env.NODE_ENV === "production";
// In production, restrict CORS to an explicit allow-list (comma-separated
// origins in CORS_ORIGINS). In dev we reflect any origin so the Vite (:5173)
// and Expo-web (:8081) previews work. Never reflect arbitrary origins with
// credentials in production.
const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
app.use(
  cors({
    credentials: true,
    origin: isProd
      ? (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin))
      : true,
  }),
);
// Baseline security response headers (helmet-equivalent, dependency-free).
// X-Content-Type-Options is important for the /uploads static route so a
// MIME-spoofed upload cannot be sniffed+executed as HTML/JS.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
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

// Serve uploaded files (local-disk storage provider).
app.use("/uploads", express.static(UPLOADS_DIR, { fallthrough: true, maxAge: "1h" }));

app.use("/api", router);
app.use("/v1", v1Router);

// Terminal error handler: never leak stack traces / internal errors to clients.
// Express 5 forwards rejected async handlers here. Logs the full error, returns
// the standard envelope.
app.use((err: unknown, req: Request, res: import("express").Response, _next: import("express").NextFunction) => {
  (req as Request & { log?: { error: (o: unknown, m: string) => void } }).log?.error?.({ err }, "unhandled error");
  if (res.headersSent) return;
  fail(res, 500, "ERR_INTERNAL", "Something went wrong.");
});

export default app;
