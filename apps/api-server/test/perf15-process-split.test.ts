/**
 * PERF #15 — process role gating for API vs worker.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getProcessRole,
  isWorkerProcess,
  shouldRunWorkersAndCrons,
} from "../src/lib/process-role";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("PERF #15 process split", () => {
  it("the worker entry starts no HTTP listener", () => {
    const src = readFileSync(path.join(root, "src/worker.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']\.\/app["']/);
    expect(src).not.toMatch(/\.listen\s*\(/);
    expect(src).toMatch(/startQueueWorkers/);
    expect(src).toMatch(/startScheduler/);
    expect(src).toMatch(/UV_THREADPOOL_SIZE/);
    expect(src).toMatch(/sharp\.concurrency\(1\)/);
  });

  it("the API entry registers no cron when PROCESS_ROLE is not worker", () => {
    const prevRole = process.env.PROCESS_ROLE;
    const prevInline = process.env.RUN_WORKERS_INLINE;
    try {
      delete process.env.PROCESS_ROLE;
      delete process.env.RUN_WORKERS_INLINE;
      expect(getProcessRole()).toBe("api");
      expect(isWorkerProcess()).toBe(false);
      expect(shouldRunWorkersAndCrons()).toBe(false);

      process.env.RUN_WORKERS_INLINE = "1";
      expect(shouldRunWorkersAndCrons()).toBe(true);

      process.env.PROCESS_ROLE = "worker";
      delete process.env.RUN_WORKERS_INLINE;
      expect(isWorkerProcess()).toBe(true);
      expect(shouldRunWorkersAndCrons()).toBe(true);
    } finally {
      if (prevRole === undefined) delete process.env.PROCESS_ROLE;
      else process.env.PROCESS_ROLE = prevRole;
      if (prevInline === undefined) delete process.env.RUN_WORKERS_INLINE;
      else process.env.RUN_WORKERS_INLINE = prevInline;
    }

    const indexSrc = readFileSync(path.join(root, "src/index.ts"), "utf8");
    expect(indexSrc).toMatch(/shouldRunWorkersAndCrons/);
    expect(indexSrc).toMatch(/startScheduler/);
  });
});
