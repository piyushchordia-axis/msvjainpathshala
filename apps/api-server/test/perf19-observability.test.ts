/**
 * PERF #19 — PII redaction must strip phone + otp from emitted log lines.
 */
import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { PINO_REDACT_PATHS } from "../src/lib/logger";

describe("PERF #19 PII redaction", () => {
  it("a log line containing a phone number and an OTP emits neither", () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk).toString("utf8"));
        cb();
      },
    });
    const log = pino(
      {
        level: "info",
        redact: [...PINO_REDACT_PATHS],
      },
      stream,
    );

    log.info(
      {
        phone: "919876543210",
        otp: "654321",
        email: "child@example.com",
        nested: { token: "secret-refresh-token", pan: "ABCDE1234F" },
      },
      "auth attempt",
    );

    const out = chunks.join("");
    expect(out).toContain("auth attempt");
    expect(out).not.toContain("919876543210");
    expect(out).not.toContain("654321");
    expect(out).not.toContain("child@example.com");
    expect(out).not.toContain("secret-refresh-token");
    expect(out).not.toContain("ABCDE1234F");
    expect(out).toMatch(/\[Redacted\]/i);
  });
});

describe("PERF #19 metrics", () => {
  it("exposes process and http metrics on /metrics for loopback", async () => {
    const { default: app } = await import("../src/app");
    const request = (await import("supertest")).default;
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toContain("http_request_duration_seconds");
    expect(res.text).toContain("pg_pool_connections");
  });
});
