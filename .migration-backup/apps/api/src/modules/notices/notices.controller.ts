/**
 * NoticesController — `/v1/notices/*` and `/v1/admin/notices/*`
 * (SPEC §6.13).
 *
 *   POST    /v1/admin/notices                 shikshak (batch), sanchalak (centre), city_admin+
 *   POST    /v1/admin/notices/estimate-sms    same — preview cost BEFORE create
 *   GET     /v1/admin/notices                 city-scoped admin grid
 *   PATCH   /v1/admin/notices/:id/pin         author or city_admin+
 *
 *   GET     /v1/notices                       jwt — unified feed for caller
 *   GET     /v1/notices/public                @Public — guest + website
 *   POST    /v1/notices/:id/read              jwt
 */

import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES, NOTICE_AUDIENCES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { NoticesService, type ScopedActor } from './notices.service';

const createNoticeSchema = z.object({
  scope: z.enum(NOTICE_AUDIENCES),
  centre_id: z.string().uuid().optional(),
  batch_id: z.string().uuid().optional(),
  msv_only: z.boolean().optional(),
  content_en: z.string().min(2).max(4000),
  content_hi: z.string().min(2).max(4000),
  attachments: z.record(z.any()).optional(),
  pinned: z.boolean().optional(),
  scheduled_for: z.string().datetime().optional(),
  is_public: z.boolean().optional(),
  is_critical: z.boolean().optional(),
  send_sms: z.boolean().optional(),
});

const adminListQuery = z.object({
  scope: z.enum(NOTICE_AUDIENCES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1000).optional(),
});

const pinSchema = z.object({ pinned: z.boolean() });

function toScopedActor(user: CurrentUserPayload | undefined): ScopedActor {
  if (!user) {
    throw new AppError({
      code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
      message: 'Not authenticated',
      statusCode: 401,
    });
  }
  const out: ScopedActor = { user_id: user.sub, role: user.role };
  if (user.scope.city_id) out.city_id = user.scope.city_id;
  if (user.scope.centre_ids) out.centre_ids = user.scope.centre_ids;
  if (user.scope.batch_ids) out.batch_ids = user.scope.batch_ids;
  return out;
}

@Controller('/v1')
export class NoticesController {
  constructor(private readonly service: NoticesService) {}

  // ===========================================================================
  // Admin
  // ===========================================================================

  @Roles('shikshak')
  @Post('/admin/notices')
  @HttpCode(201)
  async create(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(createNoticeSchema)) body: z.infer<typeof createNoticeSchema>,
  ) {
    return this.service.create(toScopedActor(user), {
      scope: body.scope,
      ...(body.centre_id ? { centre_id: body.centre_id } : {}),
      ...(body.batch_id ? { batch_id: body.batch_id } : {}),
      ...(body.msv_only !== undefined ? { msv_only: body.msv_only } : {}),
      content_en: body.content_en,
      content_hi: body.content_hi,
      ...(body.attachments ? { attachments: body.attachments } : {}),
      ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
      ...(body.scheduled_for ? { scheduled_for: body.scheduled_for } : {}),
      ...(body.is_public !== undefined ? { is_public: body.is_public } : {}),
      ...(body.is_critical !== undefined ? { is_critical: body.is_critical } : {}),
      ...(body.send_sms !== undefined ? { send_sms: body.send_sms } : {}),
    });
  }

  @Roles('shikshak')
  @Post('/admin/notices/estimate-sms')
  @HttpCode(200)
  async estimate(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(createNoticeSchema)) body: z.infer<typeof createNoticeSchema>,
  ) {
    return this.service.estimateSmsCost(toScopedActor(user), {
      scope: body.scope,
      ...(body.centre_id ? { centre_id: body.centre_id } : {}),
      ...(body.batch_id ? { batch_id: body.batch_id } : {}),
      ...(body.msv_only !== undefined ? { msv_only: body.msv_only } : {}),
      content_en: body.content_en,
      content_hi: body.content_hi,
    });
  }

  @Roles('shikshak')
  @Get('/admin/notices')
  async listForAdmin(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(adminListQuery)) q: z.infer<typeof adminListQuery>,
  ) {
    const items = await this.service.listForAdmin(toScopedActor(user), {
      ...(q.scope ? { scope: q.scope } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      ...(q.offset !== undefined ? { offset: q.offset } : {}),
    });
    return { items };
  }

  @Roles('shikshak')
  @Patch('/admin/notices/:id/pin')
  async pin(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(pinSchema)) body: z.infer<typeof pinSchema>,
  ) {
    return this.service.setPinned(toScopedActor(user), id, body.pinned);
  }

  // ===========================================================================
  // Caller-side
  // ===========================================================================

  @Get('/notices')
  async listForCaller(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query() q: { limit?: string; offset?: string },
  ) {
    const limit = q.limit ? Math.min(Math.max(Number(q.limit), 1), 200) : 50;
    const offset = q.offset ? Math.max(0, Number(q.offset)) : 0;
    const items = await this.service.listForCaller(toScopedActor(user), { limit, offset });
    return { items };
  }

  @Public()
  @Get('/notices/public')
  async listPublic(@Query() q: { limit?: string; offset?: string }) {
    const limit = q.limit ? Math.min(Math.max(Number(q.limit), 1), 200) : 50;
    const offset = q.offset ? Math.max(0, Number(q.offset)) : 0;
    const items = await this.service.listPublic({ limit, offset });
    return { items };
  }

  @Post('/notices/:id/read')
  @HttpCode(200)
  async markRead(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') noticeId: string,
  ) {
    return this.service.markRead(toScopedActor(user), noticeId);
  }
}
