/**
 * Prometheus metrics registry — one process-wide instance with default Node
 * metrics + an HTTP request counter the request logger increments.
 *
 * Counters are added piecemeal in later steps (queue depth, attendance
 * marks/sec, OTP rate, etc.); Step 3 just establishes the registry + Node
 * defaults so /metrics is non-empty.
 */

import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpRequestsTotal = new Counter({
    name: 'jp_api_http_requests_total',
    help: 'HTTP requests by method, route and status code.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  readonly httpRequestDurationSeconds = new Histogram({
    name: 'jp_api_http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'jp_api_',
    });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
