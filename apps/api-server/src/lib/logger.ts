import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

/** Paths redacted in every log line (CLAUDE.md PII list — PERF #19). */
export const PINO_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "phone",
  "*.phone",
  "req.body.phone",
  "email",
  "*.email",
  "req.body.email",
  "pan",
  "*.pan",
  "req.body.pan",
  "aadhaar",
  "*.aadhaar",
  "req.body.aadhaar",
  "password",
  "*.password",
  "req.body.password",
  "otp",
  "*.otp",
  "req.body.otp",
  "token",
  "*.token",
  "req.body.token",
] as const;

// Production: async, buffered stdout (sync:false). Default pino destination is
// a blocking write(2) per line — measurable under load (PERF #19). Dev keeps
// pino-pretty via transport (incompatible with a custom destination).
const destination = isProduction
  ? pino.destination({ dest: 1, sync: false, minLength: 4096 })
  : undefined;

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    redact: [...PINO_REDACT_PATHS],
    ...(isProduction
      ? {}
      : {
          transport: {
            target: "pino-pretty",
            options: { colorize: true },
          },
        }),
  },
  destination,
);
