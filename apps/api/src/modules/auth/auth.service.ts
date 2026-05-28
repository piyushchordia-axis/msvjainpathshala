/**
 * AuthService — orchestrates OTP verify → user resolution → session insert →
 * token mint → audit emit. Each step lives in its own service; this is the
 * conductor.
 *
 *   1. OtpService.verify(phone, code)         — throws on failure
 *   2. UsersRepository.findByPhone / createGuest
 *   3. Generate sessionId UUID                — used by both JWT + session row
 *   4. TokenRotationService.issueInitialPair  — mints JWTs, inserts family,
 *                                                returns plaintext + argon2 hash
 *   5. DeviceSessionService.create             — inserts session row (with
 *                                                hash from step 4), enforces
 *                                                max-5 + audits revocations
 *   6. UsersRepository.updateLastLoginAt
 *   7. AuditService.emit('auth.login.success', …)
 */

import { Injectable } from '@nestjs/common';

import { type Role } from '@jp/shared';

import { SystemConfigService } from '../../core/system-config/system-config.service';
import { UsersRepository } from '../../db/repositories';
import { AuditService } from '../audit/audit.service';

import { DeviceSessionService } from './services/device-session.service';
import { OtpService } from './services/otp.service';
import { TokenRotationService } from './services/token-rotation.service';

export interface VerifyOtpInput {
  phone: string;
  code: string;
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string;
}

export interface VerifyOtpResult {
  user: {
    id: string;
    phone: string;
    role: Role;
    full_name: string;
    preferred_language: 'en' | 'hi';
  };
  tokens: {
    access_token: string;
    refresh_token: string;
    access_expires_at: string;
    refresh_expires_at: string;
  };
  default_view_context?: 'parent';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly otp: OtpService,
    private readonly users: UsersRepository,
    private readonly sessions: DeviceSessionService,
    private readonly tokens: TokenRotationService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
  ) {}

  async verifyOtpAndIssue(input: VerifyOtpInput): Promise<VerifyOtpResult> {
    // 1. Verify the OTP (throws AppError on failure — caller's filter renders).
    await this.otp.verify(input.phone, input.code);

    // 2. Resolve or create the user.
    let user = await this.users.findByPhone(input.phone);
    let newGuest = false;
    if (!user) {
      user = await this.users.createGuest(input.phone);
      newGuest = true;
    }
    const userRole = user.role as Role;

    // 3. Pre-generate the session id so the JWT and session row co-reference.
    const sessionId = crypto.randomUUID();
    const refreshTtl = await this.config.getNumber('jwt.refresh_ttl_seconds');

    // 4. Insert the session row FIRST (the family row's FK points here).
    //    Refresh hash starts as a placeholder; step 5 below overwrites it.
    const placeholderHash = '$argon2id$v=19$m=65536,t=3,p=4$cGxhY2Vob2xkZXI$cGxhY2Vob2xkZXI';
    await this.sessions.create({
      sessionId,
      userId: user.id,
      userRole,
      deviceId: input.deviceId,
      platform: input.platform,
      refreshTokenHash: placeholderHash,
      expiresAt: new Date(Date.now() + refreshTtl * 1000),
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });

    // 5. Mint tokens + insert family row (FK to session now satisfied),
    //    then overwrite the session's placeholder hash with the real one
    //    so refresh-rotation can verify against device_sessions too.
    const pair = await this.tokens.issueInitialPair({
      userId: user.id,
      userRole,
      scope: {},
      viewContext: 'parent',
      deviceSessionId: sessionId,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    });
    await this.sessions.updateRefreshHash(sessionId, pair.refresh_token_hash);

    // 6. Touch last_login_at.
    await this.users.updateLastLoginAt(user.id, new Date());

    // 7. Audit (and the guest-created event when applicable).
    if (newGuest) {
      await this.audit.emit({
        actor_user_id: user.id,
        actor_role: userRole,
        action: 'user.created.guest',
        entity_kind: 'user',
        entity_id: user.id,
        after: { phone: input.phone, role: 'guest' },
        ip: input.ip ?? null,
        user_agent: input.userAgent ?? null,
        request_id: input.requestId ?? null,
      });
    }
    await this.audit.emit({
      actor_user_id: user.id,
      actor_role: userRole,
      action: 'auth.login.success',
      entity_kind: 'user',
      entity_id: user.id,
      after: { device_id: input.deviceId, platform: input.platform, new_user: newGuest },
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
      request_id: input.requestId ?? null,
    });

    return {
      user: {
        id: user.id,
        phone: user.phone,
        role: userRole,
        full_name: user.full_name,
        preferred_language: user.preferred_language as 'en' | 'hi',
      },
      tokens: {
        access_token: pair.access_token,
        refresh_token: pair.refresh_token,
        access_expires_at: pair.access_expires_at,
        refresh_expires_at: pair.refresh_expires_at,
      },
      ...(userRole === 'parent' ? { default_view_context: 'parent' as const } : {}),
    };
  }
}
