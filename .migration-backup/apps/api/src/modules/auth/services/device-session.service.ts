/**
 * DeviceSessionService — wraps the device_sessions table with the
 * Step-5-defined business rules:
 *
 *   • New login → insert; if the user now has more than the configured
 *     `session.max_active_per_user`, revoke the oldest extra(s) and audit
 *     `device.revoked_max_exceeded`.
 *   • Logout / forced revoke → mark `revoked_at`, audit `logout` or
 *     `device.revoked_by_user`.
 */

import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

import { SystemConfigService } from '../../../core/system-config/system-config.service';
import { DeviceSessionsRepository } from '../../../db/repositories';
import { AuditService } from '../../audit/audit.service';

import type { Role } from '@jp/shared';

export interface CreateDeviceSessionInput {
  /** Pre-generated id matching the JWT's device_session_id claim. */
  sessionId: string;
  userId: string;
  userRole: Role;
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
  /** Hash of the refresh token (caller's responsibility — argon2id). */
  refreshTokenHash: string;
  expiresAt: Date;
  requestId?: string;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class DeviceSessionService {
  constructor(
    private readonly repo: DeviceSessionsRepository,
    private readonly config: SystemConfigService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Insert a new session, enforce max-N, return the session row.
   *
   * The caller passes `refreshTokenHash` (already argon2id-hashed) because
   * the same hash is also stored in `refresh_token_families.current_token_hash`
   * by TokenRotationService — we want a single hash computed once.
   */
  async create(input: CreateDeviceSessionInput) {
    const session = await this.repo.insert({
      id: input.sessionId,
      user_id: input.userId,
      device_id: input.deviceId,
      platform: input.platform,
      refresh_token_hash: input.refreshTokenHash,
      expires_at: input.expiresAt,
      last_used_at: new Date(),
    });

    const maxActive = await this.config.getNumber('session.max_active_per_user');
    const revokedIds = await this.repo.revokeOldestIfOver(input.userId, maxActive);

    for (const id of revokedIds) {
      await this.audit.emit({
        actor_user_id: input.userId,
        actor_role: input.userRole,
        action: 'auth.device.revoked_max_exceeded',
        entity_kind: 'device_session',
        entity_id: id,
        after: { reason: 'max_devices_reached', user_id: input.userId },
        ip: input.ip ?? null,
        user_agent: input.userAgent ?? null,
        request_id: input.requestId ?? null,
      });
    }

    return session;
  }

  async revoke(
    sessionId: string,
    opts: {
      actorUserId: string;
      actorRole: Role;
      reason: 'logout' | 'admin_revoke' | 'reuse_detected';
      requestId?: string | null;
    },
  ): Promise<void> {
    await this.repo.revoke(sessionId);
    const action =
      opts.reason === 'logout'
        ? 'auth.logout'
        : opts.reason === 'reuse_detected'
          ? 'auth.device.revoked_reuse_detected'
          : 'auth.device.revoked_by_user';
    await this.audit.emit({
      actor_user_id: opts.actorUserId,
      actor_role: opts.actorRole,
      action,
      entity_kind: 'device_session',
      entity_id: sessionId,
      after: { reason: opts.reason },
      request_id: opts.requestId ?? null,
    });
  }

  async revokeAllForUser(userId: string, actorRole: Role, reason: string): Promise<void> {
    await this.repo.revokeAllForUser(userId);
    await this.audit.emit({
      actor_user_id: userId,
      actor_role: actorRole,
      action: 'auth.device.revoked_all',
      entity_kind: 'user',
      entity_id: userId,
      after: { reason },
    });
  }

  async findById(id: string) {
    return this.repo.findById(id);
  }

  async updateRefreshHash(sessionId: string, refreshHash: string): Promise<void> {
    await this.repo.updateRefreshHash(sessionId, refreshHash);
  }

  /** Check whether the plaintext refresh token matches a session's hash. */
  async refreshTokenMatches(sessionId: string, refreshTokenPlaintext: string): Promise<boolean> {
    const session = await this.repo.findById(sessionId);
    if (!session || session.revoked_at) return false;
    try {
      return await argon2.verify(session.refresh_token_hash, refreshTokenPlaintext);
    } catch {
      return false;
    }
  }
}
