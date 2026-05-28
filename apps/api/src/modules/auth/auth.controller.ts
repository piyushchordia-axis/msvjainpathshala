/**
 * AuthController — every `/v1/auth/*` and `/v1/admin/impersonate` route.
 *
 * Each handler is a thin wrapper: validate input via ZodValidationPipe
 * against the schemas in `@jp/shared`, call the matching service, return
 * the result. The global TransformInterceptor wraps responses in
 * { data, meta }.
 *
 * Endpoints:
 *   POST   /v1/auth/otp/send           (was /otp/request — Step 5 prompt naming)
 *   POST   /v1/auth/otp/verify
 *   POST   /v1/auth/refresh
 *   POST   /v1/auth/logout
 *   GET    /v1/auth/me
 *   POST   /v1/auth/switch-view
 *   POST   /v1/admin/impersonate/:userId
 */

import { Body, Controller, HttpCode, Param, Patch, Post, Get, Req } from '@nestjs/common';
import { z } from 'zod';

import { otpRequestSchema, refreshSchema, switchViewSchema, logoutSchema } from '@jp/shared';
import { AppError, ERROR_CODES, type Role, type ScopeContext } from '@jp/shared';

import { getRequestContext } from '../../common/context/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { UsersRepository } from '../../db/repositories';
import { AuditService } from '../audit/audit.service';

import { AuthService } from './auth.service';
import { CurrentUser, type CurrentUserPayload } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { DeviceSessionService } from './services/device-session.service';
import { ImpersonationService } from './services/impersonation.service';
import { OtpService } from './services/otp.service';
import { TokenRotationService } from './services/token-rotation.service';
import { ViewSwitchService } from './services/view-switch.service';

import type { Request } from 'express';

// ---------------------------------------------------------------------------
// DTOs not in @jp/shared yet — local Zod schemas
// ---------------------------------------------------------------------------

// Step 5 prompt names the endpoint /otp/send and includes device fields on verify.
const otpSendSchema = otpRequestSchema; // alias for clarity at the call site

const otpVerifySendShape = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Phone must be E.164 (+91…)'),
  code: z
    .string()
    .length(6)
    .regex(/^\d{6}$/, 'OTP must be 6 digits'),
  device: z.object({
    device_id: z.string().min(1).max(128),
    platform: z.enum(['ios', 'android', 'web']),
  }),
});

const impersonateBodySchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

// PATCH /v1/auth/me — self-service profile patch. Tightened to the columns a
// user is allowed to set on themselves; never `role`, `phone`, or activity
// flags (those go through admin endpoints).
const patchMeSchema = z
  .object({
    preferred_language: z.enum(['en', 'hi']).optional(),
    full_name: z.string().min(1).max(200).optional(),
    email: z.string().email().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

@Controller('/v1')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly otp: OtpService,
    private readonly tokens: TokenRotationService,
    private readonly sessions: DeviceSessionService,
    private readonly viewSwitch: ViewSwitchService,
    private readonly impersonation: ImpersonationService,
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
  ) {}

  // -- /v1/auth/otp/send -------------------------------------------------
  @Public()
  @Post('/auth/otp/send')
  @HttpCode(202)
  async sendOtp(
    @Body(new ZodValidationPipe(otpSendSchema)) body: { phone: string },
    @Req() req: Request,
  ) {
    const ip = (req.ip ?? '').replace(/^::ffff:/, '') || null;
    const result = await this.otp.request(body.phone, ip);
    return {
      otp_token: result.otp_token,
      expires_in_seconds: result.expires_in_seconds,
    };
  }

  // -- /v1/auth/otp/verify -----------------------------------------------
  @Public()
  @Post('/auth/otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body(new ZodValidationPipe(otpVerifySendShape))
    body: z.infer<typeof otpVerifySendShape>,
    @Req() req: Request,
  ) {
    const ip = (req.ip ?? '').replace(/^::ffff:/, '') || null;
    return this.authService.verifyOtpAndIssue({
      phone: body.phone,
      code: body.code,
      deviceId: body.device.device_id,
      platform: body.device.platform,
      ip,
      userAgent: req.header('user-agent') ?? null,
      ...(getRequestContext()?.request_id !== undefined
        ? { requestId: getRequestContext()!.request_id }
        : {}),
    });
  }

  // -- /v1/auth/refresh ---------------------------------------------------
  @Public()
  @Post('/auth/refresh')
  @HttpCode(200)
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: { refresh_token: string },
    @Req() req: Request,
  ) {
    // We don't know the actor's role until we verify — but the JWT carries
    // `sub`. We'll look up the role after rotation to audit cleanly.
    // For Step 5 we use a placeholder 'guest' role on the audit path; Step 6
    // tightens this by resolving the user inside TokenRotationService.
    const ip = (req.ip ?? '').replace(/^::ffff:/, '') || null;
    const pair = await this.tokens.rotate(body.refresh_token, {
      userRole: 'guest' as Role,
      ...(getRequestContext()?.request_id !== undefined
        ? { requestId: getRequestContext()!.request_id }
        : {}),
      ip,
      userAgent: req.header('user-agent') ?? null,
    });
    return {
      access_token: pair.access_token,
      refresh_token: pair.refresh_token,
      access_expires_at: pair.access_expires_at,
      refresh_expires_at: pair.refresh_expires_at,
    };
  }

  // -- /v1/auth/logout ----------------------------------------------------
  @Post('/auth/logout')
  @HttpCode(204)
  async logout(
    @Body(new ZodValidationPipe(logoutSchema)) _body: { session_id?: string },
    @CurrentUser() user: CurrentUserPayload | undefined,
  ): Promise<void> {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    await this.sessions.revoke(user.device_session_id, {
      actorUserId: user.sub,
      actorRole: user.role,
      reason: 'logout',
      ...(getRequestContext()?.request_id !== undefined
        ? { requestId: getRequestContext()!.request_id }
        : {}),
    });
  }

  // -- /v1/auth/me --------------------------------------------------------
  @Get('/auth/me')
  async me(@CurrentUser() user: CurrentUserPayload | undefined) {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    const row = await this.users.findById(user.sub);
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'User not found',
        statusCode: 404,
      });
    }
    return {
      id: row.id,
      phone: row.phone,
      role: row.role,
      full_name: row.full_name,
      preferred_language: row.preferred_language,
      view_context: user.view_context,
      view_student_id: user.view_student_id,
      scope: user.scope,
      is_impersonation: user.is_impersonation ?? false,
      impersonator_id: user.impersonator_id,
    };
  }

  // -- PATCH /v1/auth/me --------------------------------------------------
  @Patch('/auth/me')
  @HttpCode(200)
  async patchMe(
    @Body(new ZodValidationPipe(patchMeSchema)) body: z.infer<typeof patchMeSchema>,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ) {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    const before = await this.users.findById(user.sub);
    if (!before) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'User not found',
        statusCode: 404,
      });
    }
    const updated = await this.users.updateProfile(user.sub, body);
    if (!updated) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'User not found',
        statusCode: 404,
      });
    }
    // Audit so admin operators can trace self-service profile changes
    // (and to give a paper trail when the user later disputes a setting).
    await this.audit
      .emit({
        actor_user_id: user.sub,
        actor_role: user.role,
        action: 'profile.update',
        entity_kind: 'user',
        entity_id: user.sub,
        before: {
          preferred_language: before.preferred_language,
          full_name: before.full_name,
          email: before.email,
        },
        after: {
          preferred_language: updated.preferred_language,
          full_name: updated.full_name,
          email: updated.email,
          patched_fields: Object.keys(body),
        },
        ...(getRequestContext()?.request_id !== undefined
          ? { request_id: getRequestContext()!.request_id }
          : {}),
      })
      .catch(() => undefined);

    return {
      user: {
        id: updated.id,
        phone: updated.phone,
        role: updated.role,
        full_name: updated.full_name,
        preferred_language: updated.preferred_language,
      },
    };
  }

  // -- /v1/auth/switch-view ----------------------------------------------
  @Post('/auth/switch-view')
  @HttpCode(200)
  async switchView(
    @Body(new ZodValidationPipe(switchViewSchema))
    body: { view_context: 'parent' | 'student'; student_id?: string },
    @CurrentUser() user: CurrentUserPayload | undefined,
  ) {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    if (body.view_context === 'student') {
      if (!body.student_id) {
        throw new AppError({
          code: ERROR_CODES.ERR_VALIDATION_FAILED,
          message: 'student_id is required when switching to student view',
          statusCode: 422,
        });
      }
      const ctxScope: Pick<ScopeContext, 'city_id' | 'centre_ids' | 'batch_ids'> = {
        ...(user.scope.city_id ? { city_id: user.scope.city_id } : {}),
        ...(user.scope.centre_ids ? { centre_ids: user.scope.centre_ids } : {}),
        ...(user.scope.batch_ids ? { batch_ids: user.scope.batch_ids } : {}),
      };
      return this.viewSwitch.toStudent({
        parentUserId: user.sub,
        parentRole: user.role,
        scope: ctxScope,
        deviceSessionId: user.device_session_id,
        studentId: body.student_id,
        ...(getRequestContext()?.request_id !== undefined
          ? { requestId: getRequestContext()!.request_id }
          : {}),
      });
    }
    const ctxScope: Pick<ScopeContext, 'city_id' | 'centre_ids' | 'batch_ids'> = {
      ...(user.scope.city_id ? { city_id: user.scope.city_id } : {}),
      ...(user.scope.centre_ids ? { centre_ids: user.scope.centre_ids } : {}),
      ...(user.scope.batch_ids ? { batch_ids: user.scope.batch_ids } : {}),
    };
    return this.viewSwitch.toParent({
      parentUserId: user.sub,
      parentRole: user.role,
      scope: ctxScope,
      deviceSessionId: user.device_session_id,
      ...(getRequestContext()?.request_id !== undefined
        ? { requestId: getRequestContext()!.request_id }
        : {}),
    });
  }

  // -- /v1/admin/impersonate/:userId -------------------------------------
  @Post('/admin/impersonate/:userId')
  @Roles('super_admin')
  @HttpCode(200)
  async impersonate(
    @Param('userId') targetUserId: string,
    @Body(new ZodValidationPipe(impersonateBodySchema)) body: { reason?: string },
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Req() req: Request,
  ) {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    const ip = (req.ip ?? '').replace(/^::ffff:/, '') || null;
    return this.impersonation.impersonate({
      actorUserId: user.sub,
      actorRole: user.role,
      targetUserId,
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
      ip,
      userAgent: req.header('user-agent') ?? null,
      ...(getRequestContext()?.request_id !== undefined
        ? { requestId: getRequestContext()!.request_id }
        : {}),
    });
  }
}
