/**
 * BullMQ debounce for attendance.post_process + parent notify.
 * Requires Redis (testcontainers) — durable delay / multi-worker / restart.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { QUEUE_NAMES } from "@jp/shared/constants";

describe("attendance queue debounce (BullMQ)", () => {
  let redis: StartedTestContainer;
  let redisUrl: string;

  let enqueueDebouncedJob: typeof import("../../src/lib/queues").enqueueDebouncedJob;
  let registerQueueHandler: typeof import("../../src/lib/queues").registerQueueHandler;
  let startQueueWorkers: typeof import("../../src/lib/queues").startQueueWorkers;
  let startExtraWorker: typeof import("../../src/lib/queues").startExtraWorker;
  let shutdownQueues: typeof import("../../src/lib/queues").shutdownQueues;
  let getQueueJobCounts: typeof import("../../src/lib/queues").getQueueJobCounts;

  beforeAll(async () => {
    redis = await new GenericContainer("redis:7-alpine")
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start();
    redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    process.env.REDIS_URL = redisUrl;
    process.env.LOG_LEVEL = "silent";

    const queues = await import("../../src/lib/queues");
    enqueueDebouncedJob = queues.enqueueDebouncedJob;
    registerQueueHandler = queues.registerQueueHandler;
    startQueueWorkers = queues.startQueueWorkers;
    startExtraWorker = queues.startExtraWorker;
    shutdownQueues = queues.shutdownQueues;
    getQueueJobCounts = queues.getQueueJobCounts;
  }, 120_000);

  afterAll(async () => {
    await shutdownQueues();
    await redis.stop();
    delete process.env.REDIS_URL;
  });

  async function waitFor(
    pred: () => boolean | Promise<boolean>,
    ms = 15_000,
    step = 50,
  ): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await pred()) return;
      await new Promise((r) => setTimeout(r, step));
    }
    throw new Error("waitFor timed out");
  }

  it("enqueue twice for the same session inside the window → exactly one job runs", async () => {
    await shutdownQueues();
    const sessionId = "11111111-1111-4111-8111-111111111111";
    let runs = 0;
    registerQueueHandler(QUEUE_NAMES.ATTENDANCE_POST_PROCESS, async () => {
      runs += 1;
    });
    startQueueWorkers();

    await enqueueDebouncedJob(
      QUEUE_NAMES.ATTENDANCE_POST_PROCESS,
      { session_id: sessionId },
      { jobId: `attn-pp:${sessionId}`, delayMs: 400 },
    );
    await enqueueDebouncedJob(
      QUEUE_NAMES.ATTENDANCE_POST_PROCESS,
      { session_id: sessionId },
      { jobId: `attn-pp:${sessionId}`, delayMs: 400 },
    );

    const counts = await getQueueJobCounts(QUEUE_NAMES.ATTENDANCE_POST_PROCESS);
    expect((counts?.delayed ?? 0) + (counts?.waiting ?? 0)).toBe(1);

    await waitFor(() => runs === 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(runs).toBe(1);
  });

  it("enqueue, simulate restart (re-create queue/worker) → the job still runs", async () => {
    await shutdownQueues();
    const sessionId = "22222222-2222-4222-8222-222222222222";
    let runs = 0;
    registerQueueHandler(QUEUE_NAMES.ATTENDANCE_POST_PROCESS, async () => {
      runs += 1;
    });
    startQueueWorkers();

    await enqueueDebouncedJob(
      QUEUE_NAMES.ATTENDANCE_POST_PROCESS,
      { session_id: sessionId },
      { jobId: `attn-pp:${sessionId}`, delayMs: 800 },
    );

    // Simulate deploy: tear down workers/queues, keep Redis.
    await shutdownQueues();
    expect(runs).toBe(0);

    registerQueueHandler(QUEUE_NAMES.ATTENDANCE_POST_PROCESS, async () => {
      runs += 1;
    });
    startQueueWorkers();

    await waitFor(() => runs === 1, 10_000);
    expect(runs).toBe(1);
  });

  it("two workers on the same queue → exactly one parent push per (student, session)", async () => {
    await shutdownQueues();
    const studentId = "33333333-3333-4333-8333-333333333333";
    const sessionId = "44444444-4444-4444-8444-444444444444";
    const pushes: string[] = [];

    registerQueueHandler(QUEUE_NAMES.PARENT_NOTIFY, async (data) => {
      // Simulate slow delivery so both workers could race if the job duplicated.
      await new Promise((r) => setTimeout(r, 100));
      pushes.push(`${data.student_id}:${data.session_id}`);
    });
    startQueueWorkers();
    const extra = startExtraWorker(QUEUE_NAMES.PARENT_NOTIFY);
    expect(extra).toBeTruthy();

    await enqueueDebouncedJob(
      QUEUE_NAMES.PARENT_NOTIFY,
      { kind: "attendance_marked", student_id: studentId, session_id: sessionId },
      { jobId: `attn-parent:${studentId}:${sessionId}`, delayMs: 400 },
    );
    await enqueueDebouncedJob(
      QUEUE_NAMES.PARENT_NOTIFY,
      { kind: "attendance_marked", student_id: studentId, session_id: sessionId },
      { jobId: `attn-parent:${studentId}:${sessionId}`, delayMs: 400 },
    );

    await waitFor(() => pushes.length >= 1);
    await new Promise((r) => setTimeout(r, 500));
    expect(pushes).toEqual([`${studentId}:${sessionId}`]);
  });
});
