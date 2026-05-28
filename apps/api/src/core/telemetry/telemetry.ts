/**
 * OpenTelemetry + Sentry bootstrap.
 *
 * Called from `main.ts` and `worker.ts` BEFORE NestJS is constructed — OTel
 * instrumentation needs to wrap HTTP / Postgres / Redis modules at require
 * time, so this MUST happen before any module that uses those is imported.
 *
 *   - OTel SDK is initialised unconditionally so trace_id / span_id flow into
 *     Pino logs (the mixin in `pino.config.ts` reads from the active span).
 *   - OTLP exporter is only registered when `OTEL_EXPORTER_OTLP_ENDPOINT` is
 *     set — dev / test stay quiet.
 *   - Sentry is only initialised in staging/production when `SENTRY_DSN` is
 *     non-empty (per the Step 3 prompt).
 */

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import * as Sentry from '@sentry/node';

let sdk: NodeSDK | null = null;

export interface TelemetryBootstrapOptions {
  serviceName: string;
  serviceVersion?: string;
  nodeEnv: string;
  sentryDsn?: string;
  otlpEndpoint?: string;
}

export function startTelemetry(opts: TelemetryBootstrapOptions): void {
  if (sdk) return; // idempotent — main.ts + worker.ts share the same process in tests

  const traceExporter = opts.otlpEndpoint
    ? new OTLPTraceExporter({ url: `${opts.otlpEndpoint}/v1/traces` })
    : undefined;

  // String-literal keys (rather than the ATTR_* constants) keep us insulated
  // from the semantic-conventions package's frequent renames across OTel
  // minor versions.
  const resource = new Resource({
    'service.name': opts.serviceName,
    'service.version': opts.serviceVersion ?? '0.0.0',
    'deployment.environment.name': opts.nodeEnv,
  });

  sdk = new NodeSDK({
    resource,
    ...(traceExporter ? { traceExporter } : {}),
    // Auto-instrument popular libs (http, express, pg / postgres, ioredis,
    // bullmq, …). Generates spans even without an exporter, so log lines
    // get trace_id / span_id in dev too.
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });
  sdk.start();

  if (opts.sentryDsn && (opts.nodeEnv === 'staging' || opts.nodeEnv === 'production')) {
    Sentry.init({
      dsn: opts.sentryDsn,
      environment: opts.nodeEnv,
      // Sentry's OTel integration auto-attaches the trace_id from active spans
      // so our log lines and Sentry events stitch together.
    });
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
    } catch {
      // best-effort
    }
    sdk = null;
  }
  await Sentry.close(2_000).catch(() => undefined);
}
