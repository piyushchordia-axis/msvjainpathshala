/**
 * EnrolmentsController — `/v1/enrolments/*` (Step 10).
 *
 * Routes:
 *
 *   @Public  POST   /v1/enrolments                   guest sign-up or parent add-child
 *            GET    /v1/enrolments                   sanchalak+ list, scope-filtered
 *            GET    /v1/enrolments/:id               sanchalak+
 *   @Roles   POST   /v1/enrolments/:id/approve       sanchalak+
 *   @Roles   POST   /v1/enrolments/:id/reject        sanchalak+
 *   @Roles   POST   /v1/enrolments/:id/waitlist      sanchalak+
 *   @Roles   POST   /v1/enrolments/students/:id/transfer  city_admin+
 *
 * Duplicate-detection is surfaced via the `meta.warning` lift in the
 * global TransformInterceptor — we return `{ data, warning:
 * 'duplicate_suspected', duplicate_of_student_id }` and the interceptor
 * hoists the non-`data` keys into meta. Tested in the integration
 * suite.
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { EnrolmentsService, type ScopedActor } from './enrolments.service';

const submitSchema = z.object({
  parent_phone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'parent_phone must be E.164 (+91…)')
    .optional(),
  parent_full_name: z.string().min(1).max(200).optional(),
  preferred_language: z.enum(['en', 'hi']).optional(),
  requested_centre_id: z.string().uuid(),
  requested_batch_id: z.string().uuid(),
  full_name: z.string().min(1).max(200),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dob must be YYYY-MM-DD'),
  age_group: z.enum(['bal', 'kishor', 'tarun', 'yuva']),
  father_name: z.string().max(200).optional(),
  form_data: z.record(z.string(), z.unknown()).optional(),
});

const rejectSchema = z.object({
  reason: z.string().min(1).max(500),
});

const waitlistSchema = z.object({
  reason: z.string().max(500).optional(),
});

const transferSchema = z.object({
  target_batch_id: z.string().uuid(),
});

const listQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'waitlisted']).optional(),
  batch_id: z.string().uuid().optional(),
  centre_id: z.string().uuid().optional(),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function toScopedActor(user: CurrentUserPayload): ScopedActor {
  return {
    user_id: user.sub,
    role: user.role,
    city_id: user.scope.city_id,
    centre_ids: user.scope.centre_ids,
    batch_ids: user.scope.batch_ids,
  };
}

function assertActor(user: CurrentUserPayload | undefined): asserts user is CurrentUserPayload {
  if (!user) {
    throw new AppError({
      code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
      message: 'Not authenticated',
      statusCode: 401,
    });
  }
}

@Controller('/v1/enrolments')
export class EnrolmentsController {
  constructor(private readonly service: EnrolmentsService) {}

  // ---- Submit (public — guest OR authenticated parent) ----------------
  @Public()
  @Post('/')
  @HttpCode(201)
  async submit(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(submitSchema)) body: z.infer<typeof submitSchema>,
  ) {
    const actor: ScopedActor | null = user
      ? {
          user_id: user.sub,
          role: user.role,
          city_id: user.scope.city_id,
          centre_ids: user.scope.centre_ids,
          batch_ids: user.scope.batch_ids,
        }
      : null;
    const input = user ? { ...body, parent_user_id: user.sub } : body;
    const result = await this.service.submit(actor, input);
    if (result.warning) {
      // Lifted into `meta.warning` by the global TransformInterceptor.
      return {
        enrolment: result.enrolment,
        warning: result.warning,
        duplicate_of_student_id: result.duplicate_of_student_id,
      };
    }
    return { enrolment: result.enrolment };
  }

  // ---- List / Detail (sanchalak+) -------------------------------------
  @Roles('shikshak')
  @Get('/')
  async list(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    assertActor(user);
    const items = await this.service.list(toScopedActor(user), {
      ...(q.status ? { status: q.status } : {}),
      ...(q.batch_id ? { batch_id: q.batch_id } : {}),
      ...(q.centre_id ? { centre_id: q.centre_id } : {}),
      ...(q.search ? { search: q.search } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
      ...(q.offset ? { offset: q.offset } : {}),
    });
    return { items, page_size: items.length };
  }

  @Roles('shikshak')
  @Get('/:id')
  async getOne(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    assertActor(user);
    return this.service.getById(toScopedActor(user), id);
  }

  // ---- Decisions (sanchalak+) -----------------------------------------
  @Roles('sanchalak')
  @Post('/:id/approve')
  @HttpCode(200)
  async approve(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    assertActor(user);
    return this.service.approve(toScopedActor(user), id);
  }

  @Roles('sanchalak')
  @Post('/:id/reject')
  @HttpCode(200)
  async reject(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: z.infer<typeof rejectSchema>,
  ) {
    assertActor(user);
    return this.service.reject(toScopedActor(user), id, body.reason);
  }

  @Roles('sanchalak')
  @Post('/:id/waitlist')
  @HttpCode(200)
  async waitlist(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(waitlistSchema)) body: z.infer<typeof waitlistSchema>,
  ) {
    assertActor(user);
    return this.service.waitlist(toScopedActor(user), id, body.reason);
  }

  // ---- Transfer (city_admin+) — operates on a student id, not enrolment
  @Roles('city_admin')
  @Post('/students/:studentId/transfer')
  @HttpCode(200)
  async transfer(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('studentId') studentId: string,
    @Body(new ZodValidationPipe(transferSchema)) body: z.infer<typeof transferSchema>,
  ) {
    assertActor(user);
    return this.service.transfer(toScopedActor(user), studentId, body.target_batch_id);
  }
}
