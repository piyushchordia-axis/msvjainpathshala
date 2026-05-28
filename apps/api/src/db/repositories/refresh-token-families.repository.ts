/**
 * RefreshTokenFamiliesRepository — backing table for refresh-token rotation
 * with reuse detection (SPEC §7.3).
 *
 * One family is created per device_session at login. On each refresh:
 *   • The presented refresh-token's hash is compared to `current_token_hash`.
 *   • Match  → rotate: store the new hash, bump rotation_count.
 *   • Mismatch → reuse detected: revoke this family AND all device_sessions
 *     for the user.
 *
 * `revoked_at IS NULL` is the "alive" predicate.
 */

import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { refresh_token_families } from '../schema';

import type { NewRefreshTokenFamily, RefreshTokenFamily } from '../schema';

@Injectable()
export class RefreshTokenFamiliesRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async insertForSession(input: NewRefreshTokenFamily): Promise<RefreshTokenFamily> {
    const [row] = await this.drizzle.db.insert(refresh_token_families).values(input).returning();
    if (!row) throw new Error('[RefreshTokenFamilies.insertForSession] insert returned no row');
    return row;
  }

  async findByDeviceSession(deviceSessionId: string): Promise<RefreshTokenFamily | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(refresh_token_families)
      .where(eq(refresh_token_families.device_session_id, deviceSessionId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findActiveByDeviceSession(deviceSessionId: string): Promise<RefreshTokenFamily | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(refresh_token_families)
      .where(
        and(
          eq(refresh_token_families.device_session_id, deviceSessionId),
          isNull(refresh_token_families.revoked_at),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Rotate atomically: caller must hold a transaction that selected the row
   * `FOR UPDATE` (see TokenRotationService) so two concurrent refreshes can't
   * both rotate. We update the hash + counters here.
   */
  async rotate(id: string, newTokenHash: string): Promise<void> {
    await this.drizzle.db
      .update(refresh_token_families)
      .set({
        current_token_hash: newTokenHash,
        rotation_count: sql`${refresh_token_families.rotation_count} + 1`,
        last_rotated_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(refresh_token_families.id, id));
  }

  async markReuseDetected(id: string): Promise<void> {
    await this.drizzle.db
      .update(refresh_token_families)
      .set({
        revoked_at: new Date(),
        revoked_reason: 'reuse_detected',
        updated_at: new Date(),
      })
      .where(eq(refresh_token_families.id, id));
  }

  async revokeByDeviceSession(deviceSessionId: string, reason: string): Promise<void> {
    await this.drizzle.db
      .update(refresh_token_families)
      .set({
        revoked_at: new Date(),
        revoked_reason: reason,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(refresh_token_families.device_session_id, deviceSessionId),
          isNull(refresh_token_families.revoked_at),
        ),
      );
  }
}
