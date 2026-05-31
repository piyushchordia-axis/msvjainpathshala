/**
 * GalleryController — `/v1/gallery`, `/v1/admin/gallery/*`,
 * `/v1/profile/gallery-visibility` (SPEC §6.11).
 *
 *   GET    /v1/gallery                                public — only featured / non-PII
 *   GET    /v1/admin/gallery                          sanchalak+ — scoped list
 *   POST   /v1/admin/gallery/:id/feature              sanchalak+
 *   POST   /v1/admin/gallery/:id/unfeature            sanchalak+
 *   POST   /v1/admin/gallery/:id/remove               sanchalak+ — reason required
 *   PATCH  /v1/profile/gallery-visibility             parent — Q6 blanket toggle
 */

import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AGE_GROUPS, AppError, ERROR_CODES, NIYAM_TYPES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { GalleryService, type GalleryActor } from './gallery.service';

const publicQuerySchema = z.object({
  city_id: z.string().uuid().optional(),
  featured: z.coerce.boolean().optional(),
  age_group: z.enum(AGE_GROUPS).optional(),
  niyam_type: z.enum(NIYAM_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1000).optional(),
});

const adminListQuerySchema = z.object({
  status: z.enum(['visible', 'removed', 'featured']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1000).optional(),
});

const removeBodySchema = z.object({
  reason: z.string().min(20).max(500),
});

const toggleBodySchema = z.object({
  opt_in: z.boolean(),
});

function toGalleryActor(user: CurrentUserPayload | undefined): GalleryActor {
  if (!user) {
    throw new AppError({
      code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
      message: 'Not authenticated',
      statusCode: 401,
    });
  }
  const out: GalleryActor = { user_id: user.sub, role: user.role };
  if (user.scope.city_id) out.city_id = user.scope.city_id;
  if (user.scope.centre_ids) out.centre_ids = user.scope.centre_ids;
  return out;
}

@Controller('/v1')
export class GalleryController {
  constructor(private readonly service: GalleryService) {}

  // ===========================================================================
  // Public read
  // ===========================================================================

  @Public()
  @Get('/gallery')
  async listPublic(
    @Query(new ZodValidationPipe(publicQuerySchema)) q: z.infer<typeof publicQuerySchema>,
  ) {
    return this.service.listPublic({
      ...(q.city_id ? { city_id: q.city_id } : {}),
      ...(q.featured !== undefined ? { featured: q.featured } : {}),
      ...(q.age_group ? { age_group: q.age_group } : {}),
      ...(q.niyam_type ? { niyam_type: q.niyam_type } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      ...(q.offset !== undefined ? { offset: q.offset } : {}),
    });
  }

  // ===========================================================================
  // Admin
  // ===========================================================================

  @Roles('sanchalak')
  @Get('/admin/gallery')
  async listForAdmin(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(adminListQuerySchema)) q: z.infer<typeof adminListQuerySchema>,
  ) {
    return this.service.listForAdmin(toGalleryActor(user), {
      ...(q.status ? { status: q.status } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      ...(q.offset !== undefined ? { offset: q.offset } : {}),
    });
  }

  @Roles('sanchalak')
  @Post('/admin/gallery/:id/feature')
  @HttpCode(200)
  async feature(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    return this.service.feature(toGalleryActor(user), id);
  }

  @Roles('sanchalak')
  @Post('/admin/gallery/:id/unfeature')
  @HttpCode(200)
  async unfeature(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    return this.service.unfeature(toGalleryActor(user), id);
  }

  @Roles('sanchalak')
  @Post('/admin/gallery/:id/remove')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(removeBodySchema)) body: z.infer<typeof removeBodySchema>,
  ) {
    return this.service.remove(toGalleryActor(user), id, body.reason);
  }

  // ===========================================================================
  // Parent visibility toggle (Q6)
  // ===========================================================================

  @Patch('/profile/gallery-visibility')
  async setVisibility(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(toggleBodySchema)) body: z.infer<typeof toggleBodySchema>,
  ) {
    return this.service.setGalleryVisibility(toGalleryActor(user), body.opt_in);
  }
}
