import express, { type Express, type Request } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import v1Router from "./routes/v1";
import { logger } from "./lib/logger";
import { UPLOADS_DIR } from "./lib/storage";

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
app.use(cors({ credentials: true, origin: true }));
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

export default app;
