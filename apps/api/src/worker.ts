/**
 * apps/api — Worker entrypoint (`pnpm --filter @jp/api dev:worker`).
 *
 * Loads the Step 7 background-jobs infrastructure only:
 *   - QueuesModule.forRoot()  — producer registry (every queue + .dlq pair)
 *   - QueueProcessorsModule    — every @Processor under queues/processors/*
 *   - SchedulerModule          — installs 10 BullMQ repeatable jobs
 *   - ObservabilityModule      — periodic queue depth/rate gauge exporter
 *   - Plus the core modules (config, logger, db, redis, health for metrics)
 *
 * Exposes a tiny native HTTP server on `WORKER_HEALTH_PORT` so ECS /
 * docker-compose can probe liveness even though there are no application
 * HTTP routes here.
 *
 * Graceful shutdown drains BullMQ workers within a 25 s window — past that
 * we hard-exit so ECS doesn't keep us around forever on a stuck job
 * (CLAUDE.md "BullMQ → graceful shutdown 25s drain"). nest.enableShutdownHooks
 * fires OnApplicationShutdown on every provider, which is how every Worker
 * registered via @Processor gets a chance to finish in-flight jobs.
 */

import 'reflect-metadata';

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { NestFactory } from '@nestjs/core';
import { Logger as PinoNestLogger } from 'nestjs-pino';

import { loadAndValidateEnv } from './core/config/env.schema';
import { shutdownTelemetry, startTelemetry } from './core/telemetry/telemetry';
import { QUEUE_NAMES } from './queues/queues.constants';

const DRAIN_TIMEOUT_MS = 25_000;

async function bootstrap(): Promise<void> {
  const env = loadAndValidateEnv();

  startTelemetry({
    serviceName: `${env.OTEL_SERVICE_NAME}-worker`,
    nodeEnv: env.NODE_ENV,
    ...(env.SENTRY_DSN ? { sentryDsn: env.SENTRY_DSN } : {}),
    ...(env.OTEL_EXPORTER_OTLP_ENDPOINT ? { otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT } : {}),
  });

  const { WorkerModule } = await import('./worker.module');

  const ctx = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
    abortOnError: true,
  });
  ctx.useLogger(ctx.get(PinoNestLogger));
  ctx.enableShutdownHooks();

  const log = ctx.get(PinoNestLogger);

  // Minimal health HTTP server — no controllers, no routing framework.
  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', kind: 'worker' }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });
  await new Promise<void>((resolve) =>
    httpServer.listen(env.WORKER_HEALTH_PORT, '0.0.0.0', () => resolve()),
  );

  log.log(
    `apps/api worker ready — health http://0.0.0.0:${env.WORKER_HEALTH_PORT}/healthz` +
      `  (env=${env.NODE_ENV}, kind=${env.WORKER_KIND})`,
    'WorkerBootstrap',
  );
  log.log(
    `Registered ${QUEUE_NAMES.length} BullMQ queues: ${QUEUE_NAMES.join(', ')}`,
    'WorkerBootstrap',
  );

  // ----- Graceful shutdown -------------------------------------------------
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.log(
      `Received ${signal} — draining workers (timeout ${DRAIN_TIMEOUT_MS}ms)`,
      'WorkerBootstrap',
    );

    const drain = (async () => {
      httpServer.close();
      await ctx.close();
      await shutdownTelemetry();
    })();

    const hardExit = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), DRAIN_TIMEOUT_MS).unref(),
    );

    const winner = await Promise.race([drain.then(() => 'clean' as const), hardExit]);
    if (winner === 'timeout') {
      log.error('Drain timeout exceeded — forcing exit', 'WorkerBootstrap');
      process.exit(1);
    }
    log.log('Worker shut down cleanly', 'WorkerBootstrap');
    process.exit(0);
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('[worker] bootstrap failed:', err);
  process.exit(1);
});
