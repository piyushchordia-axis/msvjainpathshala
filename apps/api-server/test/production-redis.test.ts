/**
 * PERF #5 — Redis is required in production; inline queue fallback stays for test/dev.
 */
import { afterEach, describe, expect, it } from "vitest";
import { assertProductionRedisConfigured } from "../src/lib/assert-production-redis";
import { enqueueJob, registerQueueHandler } from "../src/lib/queues";
import { QUEUE_NAMES } from "@jp/shared/constants";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env.NODE_ENV = originalEnv.NODE_ENV;
  if (originalEnv.REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalEnv.REDIS_URL;
});

describe("production Redis boot guard (PERF #5)", () => {
  it("the server refuses to start in production without REDIS_URL", () => {
    process.env.NODE_ENV = "production";
    delete process.env.REDIS_URL;
    expect(() => assertProductionRedisConfigured()).toThrow(/REDIS_URL/);
    expect(() => assertProductionRedisConfigured()).toThrow(/inline/);
  });

  it("production boot succeeds when REDIS_URL is set", () => {
    process.env.NODE_ENV = "production";
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    expect(() => assertProductionRedisConfigured()).not.toThrow();
  });

  it("the inline fallback still works in test", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.REDIS_URL;

    let ran = false;
    const name = QUEUE_NAMES.DIGEST_WEEKLY_EMAIL;
    registerQueueHandler(name, async () => {
      ran = true;
    });
    await enqueueJob(name, { ping: true });
    expect(ran).toBe(true);
  });
});
