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

/** Default opts for ordinary (non-debounced) jobs. PERF #16 — retries. */
export const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: 100,
  removeOnFail: 50,
};

/** Age-bound failed-job retention on high-volume debounced queues (PERF #16). */
export const DEBOUNCED_REMOVE_ON_FAIL = {
  age: 7 * 24 * 3600,
  count: 5_000,
} as const;

/** Queues whose handlers can run for minutes — extended lock (PERF #16). */
const LONG_RUNNING_QUEUES = new Set<string>([
  QUEUE_NAMES.ANALYTICS_REFRESH_VIEWS,
  QUEUE_NAMES.ATTENDANCE_CONSECUTIVE_CHECK,
  QUEUE_NAMES.SESSION_MATERIALISE,
  QUEUE_NAMES.PUNYA_RECONCILE,
  QUEUE_NAMES.IDCARD_GENERATION,
]);

/** @internal test + worker wiring — long jobs only. */
export function workerOptsForQueue(name: string): {
  lockDuration?: number;
  stalledInterval?: number;
  maxStalledCount?: number;
} {
  if (!LONG_RUNNING_QUEUES.has(name)) return {};
  return {
    lockDuration: 300_000,
    stalledInterval: 60_000,
    maxStalledCount: 2,
  };
}

/** Deterministic daily cron jobId so BullMQ dedupes across instances (PERF #16). */
export function dailyCronJobId(prefix: string, dateYmd: string): string {
  return `${prefix}:${dateYmd}`;
}

/** Deterministic slot jobId for sub-daily crons (PERF #16). */
export function slotCronJobId(prefix: string, slotMinutes: number, now = new Date()): string {
  const slot = Math.floor(now.getTime() / (slotMinutes * 60_000));
  return `${prefix}:${slot}`;
}

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
    // Bound Redis growth — keep recent failures for inspection (PERF #16).
    removeOnFail: DEBOUNCED_REMOVE_ON_FAIL,
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
      {
        connection: redis,
        concurrency: name === QUEUE_NAMES.SESSION_MATERIALISE ? 1 : 2,
        ...workerOptsForQueue(name),
      },
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
