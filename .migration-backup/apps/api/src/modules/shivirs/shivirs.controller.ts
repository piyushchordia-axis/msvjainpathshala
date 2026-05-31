/**
 * ShivirsController — `/v1/shivirs/*` and `/v1/admin/shivirs/*` (SPEC §6.14).
 *
 * Endpoint surface (Step 15):
 *
 *   POST   /v1/admin/shivirs                        city_admin+
 *   GET    /v1/shivirs                              any auth
 *   GET    /v1/shivirs/:id                          any auth (scoped)
 *   POST   /v1/admin/shivirs/:id/sessions           city_admin+
 *   POST   /v1/admin/shivirs/:id/volunteers         city_admin, sanchalak
 *   POST   /v1/admin/shivirs/:id/registrations      city_admin, sanchalak
 *   GET    /v1/admin/shivirs/:id/roster             city_admin, sanchalak
 *   POST   /v1/shivirs/:id/scan                     volunteer (assigned) or admin+
 *   GET    /v1/admin/shivirs/:id/live               city_admin+, sanchalak
 *   POST   /v1/admin/shivirs/:id/export             city_admin+
 *
 * The on-controller `@Roles(…)` decorator enforces minimum role; the
 * service then layers city-scope checks on top.
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { ShivirsService, type ScopedActor } from './shivirs.service';

const createEventSchema = z.object({
  city_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  location_text: z.string().max(300).optional(),
  location_lat: z.number().min(-90).max(90).optional(),
  location_lng: z.number().min(-180).max(180).optional(),
  capacity: z.number().int().min(1).max(100_000).optional(),
  msv_only: z.boolean().optional(),
  attendance_mode: z.enum(['in_out', 'present_only']),
  sessions: z
    .array(
      z.object({
        day_number: z.number().int().min(1).max(60),
        session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
        end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
      }),
    )
    .min(1)
    .max(60),
});

const assignVolunteerSchema = z.object({
  user_id: z.string().uuid(),
});

const registerStudentsSchema = z.object({
  student_ids: z.array(z.string().uuid()).min(1).max(500),
});

const scanSchema = z.object({
  shivir_session_id: z.string().uuid(),
  student_qr_code: z.string().min(1).max(2048),
  client_op_id: z.string().min(8).max(64),
  scanned_at: z.string().datetime(),
  force: z.boolean().optional(),
  device_offline: z.boolean().optional(),
});

const liveQuerySchema = z.object({
  session_id: z.string().uuid().optional(),
});

const exportQuerySchema = z.object({
  format: z.enum(['csv', 'pdf', 'both']).default('both'),
});

function toScopedActor(user: CurrentUserPayload | undefined): ScopedActor {
  if (!user) {
    throw new AppError({
      code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
      message: 'Not authenticated',
      statusCode: 401,
    });
  }
  return {
    user_id: user.sub,
    role: user.role,
    city_id: user.scope.city_id,
    centre_ids: user.scope.centre_ids,
    batch_ids: user.scope.batch_ids,
  };
}

@Controller('/v1')
export class ShivirsController {
  constructor(private readonly service: ShivirsService) {}

  // ===========================================================================
  // Reads (any auth)
  // ===========================================================================

  @Get('/shivirs')
  async list(@CurrentUser() user: CurrentUserPayload | undefined) {
    return this.service.listEvents(toScopedActor(user));
  }

  @Get('/shivirs/:id')
  async detail(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    return this.service.getEvent(toScopedActor(user), id);
  }

  // ===========================================================================
  // Admin writes
  // ===========================================================================

  @Roles('city_admin')
  @Post('/admin/shivirs')
  @HttpCode(201)
  async create(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(createEventSchema)) body: z.infer<typeof createEventSchema>,
  ) {
    return this.service.createEvent(toScopedActor(user), body);
  }

  @Roles('sanchalak')
  @Post('/admin/shivirs/:id/volunteers')
  @HttpCode(201)
  async assignVolunteer(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignVolunteerSchema))
    body: z.infer<typeof assignVolunteerSchema>,
  ) {
    return this.service.assignVolunteer(toScopedActor(user), id, body.user_id);
  }

  @Roles('sanchalak')
  @Post('/admin/shivirs/:id/registrations')
  @HttpCode(201)
  async register(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(registerStudentsSchema))
    body: z.infer<typeof registerStudentsSchema>,
  ) {
    return this.service.registerStudents(toScopedActor(user), id, body.student_ids);
  }

  @Roles('sanchalak')
  @Get('/admin/shivirs/:id/roster')
  async roster(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    return this.service.getRoster(toScopedActor(user), id);
  }

  // ===========================================================================
  // QR scan
  // ===========================================================================

  @Post('/shivirs/:id/scan')
  @HttpCode(201)
  async scan(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(scanSchema)) body: z.infer<typeof scanSchema>,
  ) {
    return this.service.scan(toScopedActor(user), id, body);
  }

  // ===========================================================================
  // Live dashboard
  // ===========================================================================

  @Roles('sanchalak')
  @Get('/admin/shivirs/:id/live')
  async live(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(liveQuerySchema)) q: z.infer<typeof liveQuerySchema>,
  ) {
    return this.service.live(
      toScopedActor(user),
      id,
      q.session_id ? { session_id: q.session_id } : {},
    );
  }

  // ===========================================================================
  // Export
  // ===========================================================================

  @Roles('city_admin')
  @Post('/admin/shivirs/:id/export')
  @HttpCode(202)
  async exportShivir(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(exportQuerySchema)) q: z.infer<typeof exportQuerySchema>,
  ) {
    return this.service.enqueueExport(toScopedActor(user), id, q.format);
  }
}
