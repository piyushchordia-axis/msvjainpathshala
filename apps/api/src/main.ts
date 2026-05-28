/**
 * apps/api — HTTP entrypoint (`pnpm --filter @jp/api dev`).
 *
 * Telemetry MUST start before any module that uses HTTP / Postgres / Redis is
 * imported — see `core/telemetry/telemetry.ts` for the why. The NestFactory
 * call below comes AFTER startTelemetry on purpose.
 */

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger as PinoNestLogger } from 'nestjs-pino';

import { loadAndValidateEnv } from './core/config/env.schema';
import { shutdownTelemetry, startTelemetry } from './core/telemetry/telemetry';

async function bootstrap(): Promise<void> {
  // 1. Validate env up front so OTel + Sentry init with the right service name.
  const env = loadAndValidateEnv();

  // 2. Boot telemetry (idempotent; safe if main + worker share a process in tests).
  startTelemetry({
    serviceName: env.OTEL_SERVICE_NAME,
    nodeEnv: env.NODE_ENV,
    ...(env.SENTRY_DSN ? { sentryDsn: env.SENTRY_DSN } : {}),
    ...(env.OTEL_EXPORTER_OTLP_ENDPOINT ? { otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT } : {}),
  });

  // 3. Nest. We import AppModule dynamically so OTel auto-instrumentation
  //    wraps every module it brings in (pg, ioredis, express, ...).
  const { AppModule } = await import('./app.module');

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true, // Defer Logger output until nestjs-pino is wired
    cors: {
      origin: env.CORS_ALLOWED_ORIGINS.length > 0 ? env.CORS_ALLOWED_ORIGINS : false,
      credentials: true,
    },
  });

  // Hand log emission to Pino so every log line carries the standard fields
  // (timestamp, level, service, env, trace_id, span_id, request_id, msg).
  app.useLogger(app.get(PinoNestLogger));

  // Enable shutdown hooks so OnModuleDestroy / OnApplicationShutdown fire on
  // SIGTERM / SIGINT (graceful DB + Redis close, OTel flush).
  app.enableShutdownHooks();

  // The express trust-proxy setting makes `req.ip` honor X-Forwarded-For when
  // running behind the AWS ALB / a local reverse proxy.
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback, linklocal, uniquelocal');

  await app.listen(env.PORT, '0.0.0.0');

  const log = app.get(PinoNestLogger);
  log.log(
    `apps/api ready — http://0.0.0.0:${env.PORT}  (env=${env.NODE_ENV}, log_level=${env.LOG_LEVEL})`,
    'Bootstrap',
  );

  // Graceful shutdown
  const close = async (signal: string): Promise<void> => {
    log.log(`Received ${signal} — shutting down…`, 'Bootstrap');
    await app.close();
    await shutdownTelemetry();
    process.exit(0);
  };
  process.once('SIGTERM', () => void close('SIGTERM'));
  process.once('SIGINT', () => void close('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('[main] bootstrap failed:', err);
  process.exit(1);
});
