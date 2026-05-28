/**
 * TokenRotationService — issues and rotates refresh tokens with
 * family-based reuse detection (SPEC §7.3).
 *
 * Algorithm:
 *   Initial login:
 *     1. Insert device_session row (DeviceSessionService.create handles
 *        max-N enforcement).
 *     2. Insert refresh_token_families row pointing at the session,
 *        storing argon2id(refresh_token).
 *     3. Mint JWT pair via JwtService.
 *
 *   Refresh request:
 *     1. Verify the refresh JWT (signature, claims).
 *     2. Look up the family row for the claim's device_session_id.
 *     3. If family.revoked_at or device_session.revoked_at → 401.
 *     4. argon2.verify(stored_hash, presented_refresh_token):
 *        - match  → rotate: mint new pair, replace hash, ++rotation_count.
 *        - mismatch → reuse detected. Mark family revoked, revoke ALL
 *          device_sessions for the user, audit `auth.refresh.reuse_detected`,
 *          return 401 ERR_AUTH_REFRESH_REUSE_DETECTED.
 *
 * The transaction (read family → compare hash → update hash) uses
 * `SELECT … FOR UPDATE` on the family row so two concurrent refreshes
 * cannot both succeed (one wins, the other becomes a reuse).
 */

import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import { ulid } from 'ulid';

import { AppError, ERROR_CODES, type Role, type ScopeContext } from '@jp/shared';

import { DrizzleService } from '../../../core/database/drizzle.service';
import { SystemConfigService } from '../../../core/system-config/system-config.service';
import { DeviceSessionsRepository, RefreshTokenFamiliesRepository } from '../../../db/repositories';
import { refresh_token_families } from '../../../db/schema';
import { AuditService } from '../../audit/audit.service';

import { JwtService } from './jwt.service';

export interface IssueInitialPairInput {
  userId: string;
  userRole: Role;
  scope: Pick<ScopeContext, 'city_id' | 'centre_ids' | 'batch_ids'>;
  viewContext: 'parent' | 'student';
  viewStudentId?: string;
  deviceSessionId: string;
  requestId?: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  refresh_expires_at: string;
}

@Injectable()
export class TokenRotationService {
  constructor(
    private readonly jwt: JwtService,
    private readonly drizzle: DrizzleService,
    private readonly config: SystemConfigService,
    private readonly families: RefreshTokenFamiliesRepository,
    private readonly sessions: DeviceSessionsRepository,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Initial issuance (called by OTP verify after the device_session insert)
  // -------------------------------------------------------------------------

  async issueInitialPair(
    input: IssueInitialPairInput,
  ): Promise<TokenPair & { refresh_token_hash: string }> {
    const [accessTtl, refreshTtl] = await Promise.all([
      this.config.getNumber('jwt.access_ttl_seconds'),
      this.config.getNumber('jwt.refresh_ttl_seconds'),
    ]);

    const familyId = crypto.randomUUID();
    const refreshJti = ulid();
    const accessJti = ulid();

    const refreshToken = await this.jwt.signRefresh(
      {
        sub: input.userId,
        device_session_id: input.deviceSessionId,
        family_id: familyId,
        jti: refreshJti,
        tkn: 'refresh',
      },
      refreshTtl,
    );

    const accessToken = await this.jwt.signAccess(
      {
        sub: input.userId,
        role: input.userRole,
        scope: this.jwt.scopeClaim(input.scope),
        view_context: input.viewContext,
        ...(input.viewStudentId ? { view_student_id: input.viewStudentId } : {}),
        device_session_id: input.deviceSessionId,
        jti: accessJti,
      },
      accessTtl,
    );

    const refreshHash = await argon2.hash(refreshToken, { type: argon2.argon2id });
    await this.families.insertForSession({
      id: familyId,
      user_id: input.userId,
      device_session_id: input.deviceSessionId,
      current_token_hash: refreshHash,
      rotation_count: 0,
    });

    const now = Date.now();
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      access_expires_at: new Date(now + accessTtl * 1000).toISOString(),
      refresh_expires_at: new Date(now + refreshTtl * 1000).toISOString(),
      refresh_token_hash: refreshHash,
    };
  }

  // -------------------------------------------------------------------------
  // Refresh rotation with reuse detection
  // -------------------------------------------------------------------------

  async rotate(
    presentedRefreshToken: string,
    opts: {
      userRole: Role;
      requestId?: string;
      ip?: string | null;
      userAgent?: string | null;
    },
  ): Promise<TokenPair & { user_id: string }> {
    let claims;
    try {
      claims = await this.jwt.verifyRefresh(presentedRefreshToken);
    } catch {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Refresh token is invalid',
        statusCode: 401,
      });
    }

    const session = await this.sessions.findById(claims.device_session_id);
    if (!session || session.revoked_at) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Session has been revoked',
        statusCode: 401,
      });
    }

    // Critical section: lock the family row, compare, rotate or revoke.
    const result = await this.drizzle.db.transaction(async (tx) => {
      const [family] = await tx
        .select()
        .from(refresh_token_families)
        .where(eq(refresh_token_families.id, claims.family_id))
        .for('update');

      if (!family || family.revoked_at) {
        // Family already revoked — likely a replay after a prior detection.
        return { kind: 'revoked' as const };
      }

      const matched = await argon2
        .verify(family.current_token_hash, presentedRefreshToken)
        .catch(() => false);

      if (!matched) {
        // Reuse detected — mark family revoked + revoke every session.
        await tx
          .update(refresh_token_families)
          .set({
            revoked_at: new Date(),
            revoked_reason: 'reuse_detected',
            updated_at: new Date(),
          })
          .where(eq(refresh_token_families.id, family.id));
        return { kind: 'reuse' as const, family };
      }

      // Happy path — mint new pair, replace hash, bump counter.
      const [accessTtl, refreshTtl] = await Promise.all([
        this.config.getNumber('jwt.access_ttl_seconds'),
        this.config.getNumber('jwt.refresh_ttl_seconds'),
      ]);

      const newRefresh = await this.jwt.signRefresh(
        {
          sub: claims.sub,
          device_session_id: session.id,
          family_id: family.id,
          jti: ulid(),
          tkn: 'refresh',
        },
        refreshTtl,
      );
      const newAccess = await this.jwt.signAccess(
        {
          sub: claims.sub,
          role: opts.userRole,
          scope: {},
          view_context: 'parent',
          device_session_id: session.id,
          jti: ulid(),
        },
        accessTtl,
      );
      const newHash = await argon2.hash(newRefresh, { type: argon2.argon2id });

      await tx
        .update(refresh_token_families)
        .set({
          current_token_hash: newHash,
          rotation_count: sql`${refresh_token_families.rotation_count} + 1`,
          last_rotated_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(refresh_token_families.id, family.id));

      return {
        kind: 'ok' as const,
        accessTtl,
        refreshTtl,
        access_token: newAccess,
        refresh_token: newRefresh,
        user_id: claims.sub,
      };
    });

    if (result.kind === 'revoked') {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Session has been revoked',
        statusCode: 401,
      });
    }

    if (result.kind === 'reuse') {
      // Revoke ALL sessions for the user so a stolen token can't keep
      // refreshing anywhere.
      await this.sessions.revokeAllForUser(claims.sub);
      await this.audit.emit({
        actor_user_id: claims.sub,
        actor_role: opts.userRole,
        action: 'auth.refresh.reuse_detected',
        entity_kind: 'refresh_token_family',
        entity_id: claims.family_id,
        after: { reason: 'token_replay', revoked_all_sessions: true },
        ip: opts.ip ?? null,
        user_agent: opts.userAgent ?? null,
        request_id: opts.requestId ?? null,
      });
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_REFRESH_REUSE_DETECTED,
        message: 'We signed you out everywhere as a safety step — please sign in again',
        statusCode: 401,
      });
    }

    // Success → audit + return
    await this.audit.emit({
      actor_user_id: claims.sub,
      actor_role: opts.userRole,
      action: 'auth.refresh.rotated',
      entity_kind: 'device_session',
      entity_id: session.id,
      ip: opts.ip ?? null,
      user_agent: opts.userAgent ?? null,
      request_id: opts.requestId ?? null,
    });
    await this.sessions.updateLastUsed(session.id);

    const now = Date.now();
    return {
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      access_expires_at: new Date(now + result.accessTtl * 1000).toISOString(),
      refresh_expires_at: new Date(now + result.refreshTtl * 1000).toISOString(),
      user_id: result.user_id,
    };
  }
}
