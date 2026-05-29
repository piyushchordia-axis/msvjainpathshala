/**
 * ServiceRequestsController — SPEC §6.19.
 *
 *   POST   /v1/service-requests                     parent
 *   GET    /v1/service-requests                     parent (own)
 *   GET    /v1/service-requests/:id/messages        parent (own) | admin (scoped)
 *
 *   GET    /v1/admin/service-requests               sanchalak+
 *   POST   /v1/admin/service-requests/:id/respond   sanchalak+ (scoped)
 *   POST   /v1/admin/service-requests/:id/status    sanchalak+
 *   POST   /v1/admin/service-requests/:id/reassign  sanchalak+
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES, SERVICE_REQUEST_STATUSES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { ServiceRequestsService, type SrActor } from './service-requests.service';

const createSchema = z.object({
  category: z.string().min(2).max(80),
  description: z.string().min(2).max(4000),
  student_id: z.string().uuid().optional(),
});

const respondSchema = z.object({
  message: z.string().min(1).max(4000),
});

const statusSchema = z.object({
  status: z.enum(SERVICE_REQUEST_STATUSES),
});

const reassignSchema = z.object({
  assignee_user_id: z.string().uuid().nullable(),
});

const adminListQuery = z.object({
  status: z.enum(SERVICE_REQUEST_STATUSES).optional(),
  assigned_to_me: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
});

@Controller('/v1')
export class ServiceRequestsController {
  constructor(private readonly service: ServiceRequestsService) {}

  // ===========================================================================
  // Parent
  // ===========================================================================

  @Roles('parent')
  @Post('/service-requests')
  @HttpCode(201)
  async submit(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    const parentUserId = this.requireUserId(user);
    return this.service.submit(parentUserId, {
      category: body.category,
      description: body.description,
      ...(body.student_id ? { student_id: body.student_id } : {}),
    });
  }

  @Roles('parent')
  @Get('/service-requests')
  async listMine(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parentUserId = this.requireUserId(user);
    const items = await this.service.listForParent(parentUserId, {
      limit: limit ? Math.min(200, Math.max(1, Number(limit))) : 50,
      offset: offset ? Math.max(0, Number(offset)) : 0,
    });
    return { items };
  }

  @Get('/service-requests/:id/messages')
  async listMessages(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    if (user.role === 'parent') {
      const items = await this.service.listMessages({ parent_user_id: user.sub }, id);
      return { items };
    }
    const items = await this.service.listMessages(this.toActor(user), id);
    return { items };
  }

  // ===========================================================================
  // Admin
  // ===========================================================================

  @Roles('sanchalak')
  @Get('/admin/service-requests')
  async adminList(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(adminListQuery)) q: z.infer<typeof adminListQuery>,
  ) {
    const actor = this.toActor(user);
    const items = await this.service.listForAdmin(actor, {
      ...(q.status ? { status: q.status } : {}),
      ...(q.assigned_to_me !== undefined ? { assigned_to_me: q.assigned_to_me } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      ...(q.offset !== undefined ? { offset: q.offset } : {}),
    });
    return { items };
  }

  @Roles('sanchalak')
  @Post('/admin/service-requests/:id/respond')
  @HttpCode(201)
  async respond(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(respondSchema)) body: z.infer<typeof respondSchema>,
  ) {
    return this.service.respond(this.toActor(user), id, body.message);
  }

  @Roles('sanchalak')
  @Post('/admin/service-requests/:id/status')
  @HttpCode(200)
  async setStatus(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(statusSchema)) body: z.infer<typeof statusSchema>,
  ) {
    return this.service.setStatus(this.toActor(user), id, body.status);
  }

  @Roles('sanchalak')
  @Post('/admin/service-requests/:id/reassign')
  @HttpCode(200)
  async reassign(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reassignSchema)) body: z.infer<typeof reassignSchema>,
  ) {
    return this.service.reassign(this.toActor(user), id, body.assignee_user_id);
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private requireUserId(user: CurrentUserPayload | undefined): string {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    return user.sub;
  }

  private toActor(user: CurrentUserPayload | undefined): SrActor {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    const out: SrActor = { user_id: user.sub, role: user.role };
    if (user.scope.city_id) out.city_id = user.scope.city_id;
    if (user.scope.centre_ids) out.centre_ids = user.scope.centre_ids;
    return out;
  }
}
