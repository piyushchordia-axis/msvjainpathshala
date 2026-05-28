/**
 * DeviceTokensRepository — push token registration + lookup.
 *
 * - `upsertForUser` is the canonical write path: it dedupes by `token`
 *   (unique index) so re-registering the same FCM token is a no-op that
 *   refreshes `last_seen_at`.
 * - `listActiveForUser` returns un-revoked tokens (the push worker uses
 *   this to assemble the FCM multicast batch).
 * - `revokeByToken` is called by the push worker when FCM returns
 *   `messaging/registration-token-not-registered`.
 * - `revokeByDeviceId` runs on logout / session revoke.
 */

import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { device_tokens } from '../schema';

import type { DeviceToken } from '../schema';

export interface UpsertDeviceTokenInput {
  user_id: string;
  platform: string;
  token: string;
  device_id?: string;
}

@Injectable()
export class DeviceTokensRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async upsertForUser(input: UpsertDeviceTokenInput): Promise<DeviceToken> {
    const now = new Date();
    const [row] = await this.drizzle.db
      .insert(device_tokens)
      .values({
        user_id: input.user_id,
        platform: input.platform,
        token: input.token,
        device_id: input.device_id ?? null,
        last_seen_at: now,
      })
      .onConflictDoUpdate({
        target: device_tokens.token,
        set: {
          user_id: input.user_id,
          platform: input.platform,
          device_id: input.device_id ?? null,
          last_seen_at: now,
          revoked_at: null,
          updated_at: now,
        },
      })
      .returning();
    if (!row) {
      throw new Error('[DeviceTokensRepository.upsertForUser] UPSERT returned no row');
    }
    return row;
  }

  async listActiveForUser(userId: string): Promise<DeviceToken[]> {
    return this.drizzle.dbRead
      .select()
      .from(device_tokens)
      .where(and(eq(device_tokens.user_id, userId), isNull(device_tokens.revoked_at)));
  }

  async listActiveForUsers(userIds: string[]): Promise<DeviceToken[]> {
    if (userIds.length === 0) return [];
    return this.drizzle.dbRead
      .select()
      .from(device_tokens)
      .where(and(inArray(device_tokens.user_id, userIds), isNull(device_tokens.revoked_at)));
  }

  async revokeByToken(token: string): Promise<void> {
    await this.drizzle.db
      .update(device_tokens)
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where(eq(device_tokens.token, token));
  }

  async revokeManyByToken(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.drizzle.db
      .update(device_tokens)
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where(inArray(device_tokens.token, tokens));
  }

  async revokeByDeviceId(userId: string, deviceId: string): Promise<void> {
    await this.drizzle.db
      .update(device_tokens)
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where(and(eq(device_tokens.user_id, userId), eq(device_tokens.device_id, deviceId)));
  }

  async revokeById(id: string, userId: string): Promise<DeviceToken | null> {
    const [row] = await this.drizzle.db
      .update(device_tokens)
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where(and(eq(device_tokens.id, id), eq(device_tokens.user_id, userId)))
      .returning();
    return row ?? null;
  }
}
