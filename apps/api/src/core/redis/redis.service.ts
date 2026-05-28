/**
 * Four-client Redis facade (SPEC §3.3, Step 3 prompt):
 *
 *   cacheClient            — application cache (L2 per SPEC §17.2)
 *   bullmqClient           — BullMQ queue connection (must NOT share with pub/sub)
 *   pubsubClient           — pub/sub for cross-instance cache invalidation
 *   socketIoAdapterClient  — @socket.io/redis-adapter publish/subscribe pair
 *
 * BullMQ and the Socket.IO adapter both call SUBSCRIBE and block their
 * connection — sharing them would deadlock other consumers. Hence separate
 * ioredis instances rather than one client.
 */

import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';

import { AppConfigService } from '../config/app-config.service';

function buildOptions(config: AppConfigService, opts: { includeKeyPrefix: boolean }): RedisOptions {
  const r = config.redis;
  return {
    // BullMQ refuses clients that have `keyPrefix` set on them — it manages
    // its own namespace via the queue prefix option. We only set keyPrefix
    // on the application-cache / pubsub / socket-adapter clients.
    ...(opts.includeKeyPrefix ? { keyPrefix: r.keyPrefix } : {}),
    tls: r.tls ? {} : undefined,
    // BullMQ requires `maxRetriesPerRequest: null` on its connection.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  };
}

function createClient(
  config: AppConfigService,
  label: string,
  opts: { includeKeyPrefix: boolean } = { includeKeyPrefix: true },
): Redis {
  const client = new Redis(config.redis.url, buildOptions(config, opts));
  client.on('error', (err) => {
    // Don't crash on transient connection errors — the readiness indicator
    // surfaces these via /readyz instead.
    Logger.warn(`[redis:${label}] ${err.message}`, 'RedisService');
  });
  return client;
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  public readonly cacheClient: Redis;
  public readonly bullmqClient: Redis;
  public readonly pubsubClient: Redis;
  public readonly socketIoAdapterClient: Redis;
  /** Companion sub-client for the Socket.IO adapter (needs a pair). */
  public readonly socketIoAdapterSubClient: Redis;

  constructor(config: AppConfigService) {
    this.cacheClient = createClient(config, 'cache');
    this.bullmqClient = createClient(config, 'bullmq', { includeKeyPrefix: false });
    this.pubsubClient = createClient(config, 'pubsub');
    this.socketIoAdapterClient = createClient(config, 'sio-pub');
    this.socketIoAdapterSubClient = createClient(config, 'sio-sub');
  }

  /** Used by the readiness indicator. */
  async ping(): Promise<boolean> {
    try {
      const reply = await this.cacheClient.ping();
      return reply === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing Redis clients…');
    await Promise.allSettled([
      this.cacheClient.quit(),
      this.bullmqClient.quit(),
      this.pubsubClient.quit(),
      this.socketIoAdapterClient.quit(),
      this.socketIoAdapterSubClient.quit(),
    ]);
  }
}
