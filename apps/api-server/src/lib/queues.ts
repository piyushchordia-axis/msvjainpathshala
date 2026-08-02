/**
 * BullMQ wiring. When REDIS_URL is unset (dev/test), jobs run inline so
 * materialise/check-out crons still work without Redis.
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

/** Enqueue a job, or run the registered handler inline when Redis is unavailable. */
export async function enqueueJob(
  name: QueueName,
  data: Record<string, unknown> = {},
  opts?: JobsOptions,
): Promise<void> {
  const q = getQueue(name);
  if (q) {
    await q.add(name, data, { removeOnComplete: 100, removeOnFail: 50, ...opts });
    return;
  }
  const handler = handlers.get(name);
  if (!handler) {
    logger.warn({ name }, "No queue handler registered; dropping inline job");
    return;
  }
  await handler(data);
}

/** Start BullMQ workers for every registered handler (no-op without Redis). */
export function startQueueWorkers(): void {
  const redis = getRedis();
  if (!redis) {
    logger.info("REDIS_URL unset — queue jobs will run inline");
    return;
  }
  for (const [name, handler] of handlers) {
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

export async function shutdownQueues(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all([...queues.values()].map((q) => q.close()));
  if (connection) await connection.quit();
}
