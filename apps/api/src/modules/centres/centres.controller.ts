/**
 * CentresController — `/v1/centres/*` per the Step 6 prompt.
 *
 * Role gating:
 *   - Listing / GET: any authenticated role; the service scope-filters.
 *   - POST / PATCH / deactivate: `city_admin+` (city_admin / state_admin / super_admin).
 *   - sanchalak assignments: `city_admin+`.
 *
 * Auth-scoped fields (city_id / state_id / centre_ids) flow from the JWT
 * via `@CurrentUser()` straight to CentresService.
 */

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { CentresService, type ScopedActor } from './centres.service';

const createCentreSchema = z.object({
  city_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  address_line: z.string().max(500).optional(),
  locality: z.string().max(200).optional(),
  pincode: z
    .string()
    .regex(/^\d{4,10}$/)
    .optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  gps_radius_m: z.number().int().min(10).max(5000).optional(),
  contact_phone: z.string().max(15).optional(),
  contact_email: z.string().email().optional(),
  academic_year: z.string().max(20).optional(),
});

const patchCentreSchema = createCentreSchema.partial().omit({ city_id: true });

const assignSanchalakSchema = z.object({
  user_id: z.string().uuid(),
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
    state_id: undefined, // populated via UsersRepository in Step 7 onward
    centre_ids: user.scope.centre_ids,
    batch_ids: user.scope.batch_ids,
  };
}

@Controller('/v1/centres')
export class CentresController {
  constructor(private readonly centres: CentresService) {}

  @Get('/')
  async list(@CurrentUser() user: CurrentUserPayload | undefined) {
    return { items: await this.centres.listForActor(toScopedActor(user)) };
  }

  @Get('/:centreId')
  async getOne(@Param('centreId') centreId: string) {
    return this.centres.getById(centreId);
  }

  @Roles('city_admin')
  @Post('/')
  @HttpCode(201)
  async create(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(createCentreSchema)) body: z.infer<typeof createCentreSchema>,
  ) {
    const actor = toScopedActor(user);
    const input = {
      ...body,
      lat: body.lat !== undefined ? String(body.lat) : undefined,
      lng: body.lng !== undefined ? String(body.lng) : undefined,
    } as unknown as Parameters<CentresService['create']>[1];
    return this.centres.create(actor, input);
  }

  @Roles('city_admin')
  @Patch('/:centreId')
  async update(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('centreId') centreId: string,
    @Body(new ZodValidationPipe(patchCentreSchema)) body: z.infer<typeof patchCentreSchema>,
  ) {
    const actor = toScopedActor(user);
    const patch = {
      ...body,
      ...(body.lat !== undefined ? { lat: String(body.lat) } : {}),
      ...(body.lng !== undefined ? { lng: String(body.lng) } : {}),
    } as unknown as Parameters<CentresService['update']>[2];
    return this.centres.update(actor, centreId, patch);
  }

  @Roles('city_admin')
  @Post('/:centreId/deactivate')
  @HttpCode(204)
  async deactivate(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('centreId') centreId: string,
  ): Promise<void> {
    await this.centres.deactivate(toScopedActor(user), centreId);
  }

  @Roles('city_admin')
  @Post('/:centreId/sanchalak-assignments')
  @HttpCode(201)
  async assignSanchalak(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('centreId') centreId: string,
    @Body(new ZodValidationPipe(assignSanchalakSchema))
    body: z.infer<typeof assignSanchalakSchema>,
  ) {
    await this.centres.assignSanchalak(toScopedActor(user), centreId, body.user_id);
    return { centre_id: centreId, user_id: body.user_id, assigned: true };
  }

  @Roles('city_admin')
  @Delete('/:centreId/sanchalak-assignments/:userId')
  @HttpCode(204)
  async revokeSanchalak(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('centreId') centreId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.centres.revokeSanchalak(toScopedActor(user), centreId, userId);
  }
}

// Suppress an unused-import warning when `Role` is only used as a type via
// CurrentUserPayload's typedef.
type _RoleAlias = Role;
