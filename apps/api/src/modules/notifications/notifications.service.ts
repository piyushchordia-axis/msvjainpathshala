/**
 * NotificationsService — in-app feed APIs + fan-out enqueue helper.
 *
 *  - `enqueueFanout(payload)` is the high-level entry point producers call
 *    when a domain event fires (enrolment.approved, notice.published, etc.).
 *    The actual recipient resolution + per-channel enqueueing happens in
 *    the `notifications.fanout` worker. Producers pay the cost of one
 *    Redis RPUSH, not N database round-trips.
 *
 *  - The rest of the methods serve the controller for the in-app feed.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { RedisService } from '../../core/redis/redis.service';
import { NotificationsRepository } from '../../db/repositories';
import { QUEUES } from '../../queues/queues.constants';

import type { NotificationFanoutPayload, NotificationEvent } from './notifications.types';
import type { Notification } from '../../db/schema';

const UNREAD_COUNT_CACHE_TTL_SECONDS = 30;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly repo: NotificationsRepository,
    @InjectQueue(QUEUES.NOTIFICATIONS_FANOUT) private readonly fanout: Queue,
    private readonly redis: RedisService,
  ) {}

  /**
   * Producer-side entry point. Domain modules call this when an event fires;
   * the heavy lifting happens in the `notifications.fanout` worker.
   * Never throws — a failed enqueue is logged but doesn't break the caller's
   * transaction. Pair this method with `audit.emit` for durable recordkeeping.
   */
  async enqueueFanout(payload: NotificationFanoutPayload): Promise<void> {
    try {
      await this.fanout.add(payload.event, payload, {
        // Per-message tweaks; the queue's defaults (3 attempts, exp backoff)
        // come from QueueModule. We keep this lightweight so producers can
        // call it on the hot path.
      });
    } catch (err) {
      this.logger.warn(
        `notifications.fanout enqueue failed (event=${payload.event}): ${(err as Error).message}`,
      );
    }
  }

  /** Sugar: enqueueFanout with a single recipient. */
  async enqueueDirect(
    event: NotificationEvent,
    userId: string,
    opts: {
      source?: { kind: string; id: string };
      data?: Record<string, unknown>;
      deep_link?: string;
    } = {},
  ): Promise<void> {
    await this.enqueueFanout({
      event,
      recipient_user_ids: [userId],
      ...(opts.source ? { source: opts.source } : {}),
      ...(opts.data ? { data: opts.data } : {}),
      ...(opts.deep_link ? { deep_link: opts.deep_link } : {}),
    });
  }

  // -------------------------------------------------------------------------
  // In-app feed
  // -------------------------------------------------------------------------

  async list(
    userId: string,
    opts: { cursor?: string; limit: number; only_unread?: boolean },
  ): Promise<{
    items: Notification[];
    next_cursor: string | null;
  }> {
    const limit = Math.max(1, Math.min(100, opts.limit ?? 20));
    const rows = await this.repo.listForUser(userId, {
      ...(opts.cursor ? { cursor: opts.cursor } : {}),
      limit: limit + 1,
      ...(opts.only_unread ? { only_unread: true } : {}),
    });
    const slice = rows.slice(0, limit);
    const next = rows.length > limit ? (slice[slice.length - 1]?.created_at ?? null) : null;
    return {
      items: slice,
      next_cursor: next ? next.toISOString() : null,
    };
  }

  async markRead(userId: string, id: string): Promise<Notification | null> {
    const row = await this.repo.markRead(userId, id);
    await this.bumpUnreadCache(userId);
    return row;
  }

  async markAllRead(userId: string): Promise<number> {
    const count = await this.repo.markAllRead(userId);
    await this.bumpUnreadCache(userId);
    return count;
  }

  /**
   * Returns the live unread count for a user, cached in Redis for 30s
   * (SPEC §17.4 batching note — read-heavy feed). Cache invalidation runs
   * on mark-read/mark-all-read writes.
   */
  async unreadCount(userId: string): Promise<number> {
    const key = this.unreadKey(userId);
    const cached = await this.redis.cacheClient.get(key).catch(() => null);
    if (cached !== null) {
      const n = Number(cached);
      if (Number.isFinite(n)) return n;
    }
    const fresh = await this.repo.unreadCount(userId);
    await this.redis.cacheClient
      .set(key, String(fresh), 'EX', UNREAD_COUNT_CACHE_TTL_SECONDS)
      .catch(() => undefined);
    return fresh;
  }

  private unreadKey(userId: string): string {
    return `notif:unread:${userId}`;
  }

  private async bumpUnreadCache(userId: string): Promise<void> {
    await this.redis.cacheClient.del(this.unreadKey(userId)).catch(() => undefined);
  }
}
