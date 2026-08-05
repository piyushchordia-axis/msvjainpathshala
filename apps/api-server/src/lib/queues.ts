/**
 * BullMQ wiring. When REDIS_URL is unset (dev/test), jobs run inline so
 * materialise/check-out crons still work without Redis. Debounced jobs
 * require Redis for durable sliding windows — without it they run promptly.
 */
import { Queue, Worker, type JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { QUEUE_NAMES, type QueueName } from "@jp/shared/constants";
import { logger } from "./logger";

let connection: IORedis | null = null;
const queues = new Map<string, Queue>();
const workers: Worker[] = [];

export type JobHandler = (data: Record<string, unknown>) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerQueueHandler(name: QueueName, handler: JobHandler): void {
  handlers.set(name, handler);
}

function getRedis(): IORedis | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (!connection) {
    connection = new IORedis(url, { maxRetriesPerRequest: null });
    connection.on("error", (err) => logger.warn({ err }, "Redis queue connection error"));
  }
  return connection;
}

function getQueue(name: QueueName): Queue | null {
  const redis = getRedis();
  if (!redis) return null;
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redis });
    queues.set(name, q);
  }
  return q;
}

/** Default opts for ordinary (non-debounced) jobs. */
const DEFAULT_JOB_OPTS: JobsOptions = {
  removeOnComplete: 100,
  removeOnFail: 50,
};

/** Enqueue a job, or run the registered handler inline when Redis is unavailable. */
export async function enqueueJob(
  name: QueueName,
  data: Record<string, unknown> = {},
  opts?: JobsOptions,
): Promise<void> {
  const q = getQueue(name);
  if (q) {
    await q.add(name, data, { ...DEFAULT_JOB_OPTS, ...opts });
    return;
  }
  const handler = handlers.get(name);
  if (!handler) {
    logger.warn({ name }, "No queue handler registered; dropping inline job");
    return;
  }
  logger.warn({ name }, "REDIS_URL unset — running queue job inline");
  await handler(data);
}

export type DebouncedJobOpts = {
  /** Stable BullMQ jobId — one logical job per key. */
  jobId: string;
  /** Sliding delay in ms. */
  delayMs: number;
};

/** In-process sliding debounce when Redis is unavailable (dev / load-test). */
const inlineDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inlineDebouncePending = new Map<string, { data: Record<string, unknown>; handler: JobHandler }>();

/**
 * Sliding-window debounce via stable jobId: remove any existing delayed/waiting
 * job with that id, then re-add with a fresh delay. Survives process restart
 * when Redis is up. Without Redis, schedules an in-process timer (same delay)
 * so a burst does not stampede the handler once per mark.
 */
export async function enqueueDebouncedJob(
  name: QueueName,
  data: Record<string, unknown>,
  debounce: DebouncedJobOpts,
): Promise<void> {
  const q = getQueue(name);
  if (!q) {
    const handler = handlers.get(name);
    if (!handler) {
      logger.warn({ name }, "No queue handler registered; dropping inline debounced job");
      return;
    }
    const key = `${name}:${debounce.jobId}`;
    inlineDebouncePending.set(key, { data, handler });
    const existing = inlineDebounceTimers.get(key);
    if (existing) clearTimeout(existing);
    inlineDebounceTimers.set(
      key,
      setTimeout(() => {
        inlineDebounceTimers.delete(key);
        const pending = inlineDebouncePending.get(key);
        inlineDebouncePending.delete(key);
        if (!pending) return;
        void pending.handler(pending.data).catch((err) => {
          logger.error({ err, queue: name, jobId: debounce.jobId }, "inline debounced job failed");
        });
      }, debounce.delayMs),
    );
    return;
  }

  const existing = await q.getJob(debounce.jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "delayed" || state === "waiting" || state === "prioritized") {
      await existing.remove();
    } else if (state === "completed" || state === "failed") {
      await existing.remove().catch(() => undefined);
    }
    // active: leave it; add below may fail on jobId clash — fall back to a follow-up id
  }

  const opts: JobsOptions = {
    jobId: debounce.jobId,
    delay: debounce.delayMs,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: true,
    // Keep failed jobs for inspection (do not auto-prune).
    removeOnFail: false,
  };

  try {
    await q.add(name, data, opts);
  } catch (err) {
    // Active job still owns the id — schedule a follow-up that slides after it finishes.
    const followId = `${debounce.jobId}:next`;
    const follow = await q.getJob(followId);
    if (follow) {
      const st = await follow.getState();
      if (st === "delayed" || st === "waiting" || st === "prioritized") {
        await follow.remove();
      }
    }
    try {
      await q.add(name, data, { ...opts, jobId: followId });
    } catch (err2) {
      logger.warn({ err: err2, name, jobId: debounce.jobId }, "debounced enqueue failed");
      void err;
    }
  }
}

/** Start BullMQ workers for every registered handler (no-op without Redis). */
export function startQueueWorkers(): void {
  const redis = getRedis();
  if (!redis) {
    logger.warn(
      { queues: [...handlers.keys()] },
      "REDIS_URL unset — queue jobs will run inline",
    );
    return;
  }
  for (const [name, handler] of handlers) {
    // Avoid double-starting the same queue name across restarts in one process.
    if (workers.some((w) => w.name === name)) continue;
    const worker = new Worker(
      name,
      async (job) => {
        await handler((job.data ?? {}) as Record<string, unknown>);
      },
      { connection: redis, concurrency: name === QUEUE_NAMES.SESSION_MATERIALISE ? 1 : 2 },
    );
    worker.on("failed", (job, err) => {
      logger.error({ err, queue: name, jobId: job?.id }, "Queue job failed");
    });
    workers.push(worker);
    logger.info({ queue: name }, "BullMQ worker started");
  }
}

/** @internal test helper — start an extra worker on one queue (multi-worker tests). */
export function startExtraWorker(name: QueueName): Worker | null {
  const redis = getRedis();
  const handler = handlers.get(name);
  if (!redis || !handler) return null;
  const worker = new Worker(
    name,
    async (job) => {
      await handler((job.data ?? {}) as Record<string, unknown>);
    },
    { connection: redis, concurrency: 1 },
  );
  workers.push(worker);
  return worker;
}

export async function shutdownQueues(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  workers.length = 0;
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (connection) {
    await connection.quit();
    connection = null;
  }
}

/** @internal — inspect delayed/waiting counts in tests. */
export async function getQueueJobCounts(
  name: QueueName,
): Promise<Record<string, number> | null> {
  const q = getQueue(name);
  if (!q) return null;
  return q.getJobCounts("delayed", "waiting", "active", "completed", "failed");
}
