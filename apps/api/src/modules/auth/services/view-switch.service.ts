/**
 * ViewSwitchService — parent ↔ student-view toggle (CLAUDE.md Q4).
 *
 * Hard gate: the target student must be ≥ `student_view.min_age_years`
 * (default 13) AND have `student_view_enabled=true`. Enforced here, not
 * at the client.
 *
 * On switch the parent gets a NEW access token with the `view_context`
 * claim updated; the refresh token stays the same so a refresh continues
 * to issue tokens with whichever view is active.
 */

import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { AppError, ERROR_CODES, type Role, type ScopeContext } from '@jp/shared';

import { DrizzleService } from '../../../core/database/drizzle.service';
import { SystemConfigService } from '../../../core/system-config/system-config.service';
import { students } from '../../../db/schema';
import { AuditService } from '../../audit/audit.service';

import { JwtService } from './jwt.service';

@Injectable()
export class ViewSwitchService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly config: SystemConfigService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Returns a new access token with view_context='student' bound to the
   * given student id. The refresh token is left unchanged.
   */
  async toStudent(input: {
    parentUserId: string;
    parentRole: Role;
    scope: Pick<ScopeContext, 'city_id' | 'centre_ids' | 'batch_ids'>;
    deviceSessionId: string;
    studentId: string;
    requestId?: string;
  }): Promise<{ access_token: string; access_expires_at: string }> {
    if (input.parentRole !== 'parent') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only parents can switch to student view',
        statusCode: 403,
      });
    }

    const minAge = await this.config.getNumber('student_view.min_age_years');

    const [student] = await this.drizzle.dbRead
      .select()
      .from(students)
      .where(
        and(
          eq(students.id, input.studentId),
          eq(students.parent_user_id, input.parentUserId),
          isNull(students.deleted_at),
        ),
      )
      .limit(1);

    if (!student) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'No such student linked to this parent',
        statusCode: 404,
      });
    }

    if (!student.student_view_enabled) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_STUDENT_VIEW_DISABLED,
        message: 'Student view is turned off for this child',
        statusCode: 403,
      });
    }

    const ageYears = computeAgeInYears(student.dob);
    if (ageYears < minAge) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_STUDENT_VIEW_UNDERAGE,
        message: `Student view is available from age ${minAge}`,
        statusCode: 409,
      });
    }

    const accessTtl = await this.config.getNumber('jwt.access_ttl_seconds');
    const accessToken = await this.jwt.signAccess(
      {
        sub: input.parentUserId,
        role: input.parentRole,
        scope: this.jwt.scopeClaim(input.scope),
        view_context: 'student',
        view_student_id: input.studentId,
        device_session_id: input.deviceSessionId,
        jti: crypto.randomUUID(),
      },
      accessTtl,
    );

    await this.audit.emit({
      actor_user_id: input.parentUserId,
      actor_role: input.parentRole,
      action: 'auth.view.switched_to_student',
      entity_kind: 'user',
      entity_id: input.parentUserId,
      after: { student_id: input.studentId },
      request_id: input.requestId ?? null,
    });

    return {
      access_token: accessToken,
      access_expires_at: new Date(Date.now() + accessTtl * 1000).toISOString(),
    };
  }

  /** Revert to parent view — issue a new access token without view_student_id. */
  async toParent(input: {
    parentUserId: string;
    parentRole: Role;
    scope: Pick<ScopeContext, 'city_id' | 'centre_ids' | 'batch_ids'>;
    deviceSessionId: string;
    requestId?: string;
  }): Promise<{ access_token: string; access_expires_at: string }> {
    const accessTtl = await this.config.getNumber('jwt.access_ttl_seconds');
    const accessToken = await this.jwt.signAccess(
      {
        sub: input.parentUserId,
        role: input.parentRole,
        scope: this.jwt.scopeClaim(input.scope),
        view_context: 'parent',
        device_session_id: input.deviceSessionId,
        jti: crypto.randomUUID(),
      },
      accessTtl,
    );

    await this.audit.emit({
      actor_user_id: input.parentUserId,
      actor_role: input.parentRole,
      action: 'auth.view.switched_to_parent',
      entity_kind: 'user',
      entity_id: input.parentUserId,
      request_id: input.requestId ?? null,
    });

    return {
      access_token: accessToken,
      access_expires_at: new Date(Date.now() + accessTtl * 1000).toISOString(),
    };
  }
}

/**
 * Compute integer age in years from a YYYY-MM-DD date string.
 * Boundary correct: a child born on 2013-05-28 is 13yo from 2026-05-28
 * onwards (and 12yo on 2026-05-27).
 */
function computeAgeInYears(dobIso: string): number {
  const [yy, mm, dd] = dobIso.split('-').map(Number) as [number, number, number];
  const now = new Date();
  let years = now.getUTCFullYear() - yy;
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  if (m < mm || (m === mm && d < dd)) years--;
  return years;
}
