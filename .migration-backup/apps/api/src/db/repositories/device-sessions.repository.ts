/**
 * DeviceSessionsRepository — durable per-device login records.
 *
 * Used by:
 *   - OtpService.verify → insert a new session on successful login
 *   - DeviceSessionService → enforce max-N, revoke oldest, list/admin
 *   - TokenRotationService → look up by id during refresh
 *
 * The "active" set is rows where `revoked_at IS NULL` AND `expires_at > now`.
 */

import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, isNull, lt, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { device_sessions } from '../schema';

import type { DeviceSession, NewDeviceSession } from '../schema';

@Injectable()
export class DeviceSessionsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async insert(input: NewDeviceSession): Promise<DeviceSession> {
    const [row] = await this.drizzle.db.insert(device_sessions).values(input).returning();
    if (!row) throw new Error('[DeviceSessions.insert] insert returned no row');
    return row;
  }

  async findById(id: string): Promise<DeviceSession | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(device_sessions)
      .where(eq(device_sessions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Active = not revoked AND not expired. Used by max-5 enforcement. */
  async findActiveByUser(userId: string): Promise<DeviceSession[]> {
    return this.drizzle.dbRead
      .select()
      .from(device_sessions)
      .where(
        and(
          eq(device_sessions.user_id, userId),
          isNull(device_sessions.revoked_at),
          gt(device_sessions.expires_at, sql`now()`),
        ),
      )
      .orderBy(asc(device_sessions.created_at));
  }

  async countActiveByUser(userId: string): Promise<number> {
    const [{ value } = { value: 0 }] = await this.drizzle.dbRead
      .select({ value: count() })
      .from(device_sessions)
      .where(
        and(
          eq(device_sessions.user_id, userId),
          isNull(device_sessions.revoked_at),
          gt(device_sessions.expires_at, sql`now()`),
        ),
      );
    return value;
  }

  async revoke(id: string): Promise<void> {
    await this.drizzle.db
      .update(device_sessions)
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where(and(eq(device_sessions.id, id), isNull(device_sessions.revoked_at)));
  }

  /**
   * Revoke EVERY active session for a user. Called by:
   *  - logout-all (admin / user-initiated)
   *  - refresh reuse detection — see also `RefreshTokenFamiliesRepository`
   */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.drizzle.db
      .update(device_sessions)
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where(and(eq(device_sessions.user_id, userId), isNull(device_sessions.revoked_at)));
  }

  /**
   * If user has more than `limit` active sessions, revoke the oldest until
   * the count drops to `limit`. Returns the ids of revoked sessions so the
   * caller can emit audit entries.
   */
  async revokeOldestIfOver(userId: string, limit: number): Promise<string[]> {
    const active = await this.findActiveByUser(userId);
    if (active.length <= limit) return [];
    const excess = active.length - limit;
    const toRevoke = active.slice(0, excess);
    for (const sess of toRevoke) {
      await this.revoke(sess.id);
    }
    return toRevoke.map((s) => s.id);
  }

  async updateLastUsed(id: string): Promise<void> {
    await this.drizzle.db
      .update(device_sessions)
      .set({ last_used_at: new Date(), updated_at: new Date() })
      .where(eq(device_sessions.id, id));
  }

  async updateRefreshHash(id: string, refreshTokenHash: string): Promise<void> {
    await this.drizzle.db
      .update(device_sessions)
      .set({ refresh_token_hash: refreshTokenHash, updated_at: new Date() })
      .where(eq(device_sessions.id, id));
  }

  /** Used by the daily auth.session.cleanup cron to purge expired rows. */
  async deleteExpiredBefore(cutoff: Date): Promise<number> {
    const result = await this.drizzle.db
      .delete(device_sessions)
      .where(lt(device_sessions.expires_at, cutoff));
    return (result as unknown as { count?: number }).count ?? 0;
  }
}
