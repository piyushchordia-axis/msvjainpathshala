/**
 * QueueMetricsService — periodic exporter of BullMQ queue depth gauges to
 * the shared Prometheus registry. Read by Grafana for the auto-scaling
 * decision (SPEC §18.10 worker-overview dashboard).
 *
 * Three gauges per queue (and per `.dlq` counterpart):
 *
 *   jp_queue_depth{queue="..."}             waiting + delayed + active
 *   jp_queue_processing_rate{queue="..."}   completed jobs since last scrape
 *                                           (raw delta — Grafana wraps with
 *                                            rate() to compute /sec)
 *   jp_queue_dlq_size{queue="..."}          waiting count on the .dlq queue
 *
 * Implementation notes:
 *   - We construct one lightweight `Queue` per name with the shared
 *     `bullmqClient` connection — these are read-only views, the producer
 *     queues from QueuesModule do the actual enqueue work.
 *   - Tick interval is 30s (Step 7 prompt). We track previous `completed`
 *     counts in-memory so we can publish a delta gauge for processing rate;
 *     restart resets the baseline (acceptable for ops dashboards).
 *   - The gauges are registered on the shared MetricsService.registry so
 *     `/metrics` includes them without extra wiring.
 */

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { Gauge } from 'prom-client';

import { MetricsService } from '../core/health/metrics.service';
import { RedisService } from '../core/redis/redis.service';
import { QUEUE_NAMES, dlqName } from '../queues/queues.constants';

const TICK_MS = 30_000;

@Injectable()
export class QueueMetricsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(QueueMetricsService.name);
  private readonly queues = new Map<string, Queue>();
  private readonly previousCompleted = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  private readonly depthGauge: Gauge<'queue'>;
  private readonly rateGauge: Gauge<'queue'>;
  private readonly dlqGauge: Gauge<'queue'>;

  constructor(
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
  ) {
    this.depthGauge = new Gauge({
      name: 'jp_queue_depth',
      help: 'BullMQ queue depth (waiting + delayed + active).',
      labelNames: ['queue'] as const,
      registers: [this.metrics.registry],
    });
    this.rateGauge = new Gauge({
      name: 'jp_queue_processing_rate',
      help: 'BullMQ jobs completed since previous scrape (raw delta; wrap with rate() in Grafana).',
      labelNames: ['queue'] as const,
      registers: [this.metrics.registry],
    });
    this.dlqGauge = new Gauge({
      name: 'jp_queue_dlq_size',
      help: 'BullMQ DLQ waiting count for each primary queue.',
      labelNames: ['queue'] as const,
      registers: [this.metrics.registry],
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    for (const name of QUEUE_NAMES) {
      this.queues.set(name, new Queue(name, { connection: this.redis.bullmqClient }));
      const dlq = dlqName(name);
      this.queues.set(dlq, new Queue(dlq, { connection: this.redis.bullmqClient }));
    }
    // First sample immediately so /metrics has values before the first tick.
    await this.sample().catch((err: unknown) => {
      this.logger.warn(
        `initial queue-metrics sample failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    this.timer = setInterval(() => {
      void this.sample().catch((err: unknown) => {
        this.logger.warn(
          `queue-metrics sample failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, TICK_MS);
    // Don't keep the event loop alive solely for this timer.
    this.timer.unref();
    this.logger.log(`queue-metrics started (interval=${TICK_MS}ms, queues=${QUEUE_NAMES.length})`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
  }

  /**
   * Read counts for every queue + DLQ and update the gauges. Failures are
   * isolated per queue so a single broken queue doesn't blank the whole
   * dashboard.
   */
  async sample(): Promise<void> {
    for (const name of QUEUE_NAMES) {
      const primary = this.queues.get(name);
      const dlq = this.queues.get(dlqName(name));
      if (!primary || !dlq) continue;

      try {
        const counts = await primary.getJobCounts(
          'waiting',
          'delayed',
          'active',
          'completed',
          'failed',
        );
        const depth = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0);
        this.depthGauge.set({ queue: name }, depth);

        const completed = counts.completed ?? 0;
        const previous = this.previousCompleted.get(name) ?? completed;
        const delta = Math.max(0, completed - previous);
        this.previousCompleted.set(name, completed);
        this.rateGauge.set({ queue: name }, delta);
      } catch (err) {
        this.logger.debug(
          `sample failed for ${name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      try {
        const dlqCounts = await dlq.getJobCounts('waiting', 'delayed', 'failed');
        const dlqSize =
          (dlqCounts.waiting ?? 0) + (dlqCounts.delayed ?? 0) + (dlqCounts.failed ?? 0);
        this.dlqGauge.set({ queue: name }, dlqSize);
      } catch (err) {
        this.logger.debug(
          `dlq sample failed for ${name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
