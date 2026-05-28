/**
 * DeviceTokensService — public API for FCM/APNs token registration.
 *
 * The mobile client calls POST /v1/device-tokens on login to enable push
 * notifications. The web client also uses this for browser push.
 * Audit is intentionally low-touch — we don't want a row in `audit_logs`
 * per token refresh (FCM rotates tokens routinely).
 */

import { Injectable } from '@nestjs/common';

import { DeviceTokensRepository } from '../../db/repositories';

import type { DeviceToken } from '../../db/schema';

const ALLOWED_PLATFORMS = ['ios', 'android', 'web'] as const;
type Platform = (typeof ALLOWED_PLATFORMS)[number];

@Injectable()
export class DeviceTokensService {
  constructor(private readonly repo: DeviceTokensRepository) {}

  async register(input: {
    user_id: string;
    platform: string;
    token: string;
    device_id?: string;
  }): Promise<DeviceToken> {
    const platform: Platform = (ALLOWED_PLATFORMS as readonly string[]).includes(input.platform)
      ? (input.platform as Platform)
      : 'web';
    return this.repo.upsertForUser({
      user_id: input.user_id,
      platform,
      token: input.token,
      ...(input.device_id ? { device_id: input.device_id } : {}),
    });
  }

  async deleteById(userId: string, tokenId: string): Promise<boolean> {
    const row = await this.repo.revokeById(tokenId, userId);
    return row !== null;
  }
}
