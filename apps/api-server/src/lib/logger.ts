import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    // PII: never log raw phone numbers. Callers should mask before logging
    // (e.g. "****1234"); this is defense-in-depth for accidental raw values.
    "phone",
    "*.phone",
    "req.body.phone",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
