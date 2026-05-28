/**
 * MsvController — `/v1/msv/enrolments/*` (Step 10).
 *
 * Roles:
 *   - POST   /v1/msv/enrolments              parent (apply for own child)
 *   - GET    /v1/msv/enrolments              city_admin+ (scope-filtered)
 *   - GET    /v1/msv/enrolments/:id          city_admin+
 *   - POST   /v1/msv/enrolments/:id/approve  city_admin+
 *   - POST   /v1/msv/enrolments/:id/reject   city_admin+
 *   - POST   /v1/msv/enrolments/:id/waitlist city_admin+
 *
 * Q1: NO eligibility validation — admin discretion only.
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES, msvApplicationSchema } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { MsvService, type ScopedActor } from './msv.service';

// Decision write-shapes live locally because the controller routes verbs
// through the URL (`/:id/approve`, `/:id/reject`, `/:id/waitlist`) and the
// body just carries the admin's free-form `notes`. Reject requires a
// non-empty justification — approve/waitlist make it optional.
const decideSchema = z.object({
  notes: z.string().max(1000).optional(),
});

const rejectSchema = z.object({
  notes: z.string().min(1).max(1000),
});

const listQuerySchema = z.object({
  status: z.enum(['none', 'applied', 'waitlisted', 'approved', 'rejected', 'revoked']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function assertActor(user: CurrentUserPayload | undefined): asserts user is CurrentUserPayload {
  if (!user) {
    throw new AppError({
      code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
      message: 'Not authenticated',
      statusCode: 401,
    });
  }
}

function toScopedActor(user: CurrentUserPayload): ScopedActor {
  return {
    user_id: user.sub,
    role: user.role,
    city_id: user.scope.city_id,
    centre_ids: user.scope.centre_ids,
  };
}

@Controller('/v1/msv/enrolments')
export class MsvController {
  constructor(private readonly service: MsvService) {}

  // ---- Apply (parent) ------------------------------------------------
  @Roles('parent')
  @Post('/')
  @HttpCode(201)
  async apply(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(msvApplicationSchema)) body: z.infer<typeof msvApplicationSchema>,
  ) {
    assertActor(user);
    return this.service.apply(toScopedActor(user), body);
  }

  // ---- Admin list / detail (city_admin+) ------------------------------
  @Roles('city_admin')
  @Get('/')
  async list(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    assertActor(user);
    const items = await this.service.list(toScopedActor(user), {
      ...(q.status ? { status: q.status } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
      ...(q.offset ? { offset: q.offset } : {}),
    });
    return { items, page_size: items.length };
  }

  @Roles('city_admin')
  @Get('/:id')
  async getOne(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    assertActor(user);
    return this.service.getById(toScopedActor(user), id);
  }

  // ---- Decisions ------------------------------------------------------
  @Roles('city_admin')
  @Post('/:id/approve')
  @HttpCode(200)
  async approve(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(decideSchema)) body: z.infer<typeof decideSchema>,
  ) {
    assertActor(user);
    return this.service.approve(toScopedActor(user), id, body.notes);
  }

  @Roles('city_admin')
  @Post('/:id/reject')
  @HttpCode(200)
  async reject(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: z.infer<typeof rejectSchema>,
  ) {
    assertActor(user);
    return this.service.reject(toScopedActor(user), id, body.notes);
  }

  @Roles('city_admin')
  @Post('/:id/waitlist')
  @HttpCode(200)
  async waitlist(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(decideSchema)) body: z.infer<typeof decideSchema>,
  ) {
    assertActor(user);
    return this.service.waitlist(toScopedActor(user), id, body.notes);
  }
}
