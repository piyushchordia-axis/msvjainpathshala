/**
 * LibraryController — SPEC §6.20, Step 22.
 *
 *   Public + caller reads
 *     GET   /v1/library                          @Public (filters by tier)
 *     GET   /v1/library/:id                      @Public + scoped
 *     POST  /v1/library/:id/access-log           @Public — view/download
 *     GET   /v1/public/library                   @Public alias for guests
 *
 *   Admin
 *     POST  /v1/admin/library                    shikshak+
 *     DELETE /v1/admin/library/:id               sanchalak+ (Q7 admin scope)
 */

import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import {
  AGE_GROUPS,
  AppError,
  ERROR_CODES,
  LANGUAGES,
  LIBRARY_ACCESS_TIERS,
  LIBRARY_CONTENT_TYPES,
  type Role,
} from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { LibraryService, type LibraryCaller } from './library.service';

const createLibrarySchema = z
  .object({
    content_type: z.enum(LIBRARY_CONTENT_TYPES),
    title_en: z.string().min(1).max(200),
    title_hi: z.string().min(1).max(200),
    description_en: z.string().max(2000).optional(),
    description_hi: z.string().max(2000).optional(),
    asset_id: z.string().uuid().nullable().optional(),
    embed_url: z.string().url().nullable().optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
    age_groups: z.array(z.enum(AGE_GROUPS)).optional(),
    languages: z.array(z.enum(LANGUAGES)).optional(),
    access_tier: z.enum(LIBRARY_ACCESS_TIERS),
    msv_only: z.boolean().optional(),
    city_id: z.string().uuid().nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.content_type === 'video') {
      if (!val.embed_url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['embed_url'],
          message: 'video items require an embed_url',
        });
      }
      if (val.asset_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['asset_id'],
          message: 'video items must not carry an asset_id',
        });
      }
    } else {
      if (!val.asset_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['asset_id'],
          message: 'non-video items require an asset_id',
        });
      }
      if (val.embed_url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['embed_url'],
          message: 'embed_url only allowed for video items',
        });
      }
    }
  });

const listQuerySchema = z.object({
  content_type: z.enum(LIBRARY_CONTENT_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
});

const accessLogBody = z.object({
  action: z.enum(['view', 'download']).default('view'),
});

@Controller('/v1')
export class LibraryController {
  constructor(private readonly service: LibraryService) {}

  // -------------------------------------------------------------------------
  // Reads (public + caller-scoped)
  // -------------------------------------------------------------------------

  @Public()
  @Get('/library')
  async list(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    const caller = await this.callerFrom(user);
    const items = await this.service.list(caller, {
      ...(q.content_type ? { content_type: q.content_type } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      ...(q.offset !== undefined ? { offset: q.offset } : {}),
    });
    return { items };
  }

  @Public()
  @Get('/public/library')
  async listPublic(
    @Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    const items = await this.service.list(
      { role: 'guest' },
      {
        ...(q.content_type ? { content_type: q.content_type } : {}),
        ...(q.limit !== undefined ? { limit: q.limit } : {}),
        ...(q.offset !== undefined ? { offset: q.offset } : {}),
      },
    );
    return { items };
  }

  @Public()
  @Get('/library/:id')
  async getOne(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    const caller = await this.callerFrom(user);
    return this.service.getById(caller, id);
  }

  @Public()
  @Post('/library/:id/access-log')
  @HttpCode(201)
  async accessLog(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(accessLogBody)) body: z.infer<typeof accessLogBody>,
  ) {
    const caller = await this.callerFrom(user);
    if (body.action === 'download') {
      await this.service.logDownload(caller, id);
    } else {
      // view-only — getById already logs, so we re-call for the pure-write path
      await this.service.getById(caller, id);
    }
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------

  @Roles('shikshak')
  @Post('/admin/library')
  @HttpCode(201)
  async create(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(createLibrarySchema)) body: z.infer<typeof createLibrarySchema>,
  ) {
    const actor = this.requireAuthed(user);
    return this.service.create(actor, {
      content_type: body.content_type,
      title_en: body.title_en,
      title_hi: body.title_hi,
      ...(body.description_en !== undefined ? { description_en: body.description_en } : {}),
      ...(body.description_hi !== undefined ? { description_hi: body.description_hi } : {}),
      asset_id: body.asset_id ?? null,
      embed_url: body.embed_url ?? null,
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(body.age_groups !== undefined ? { age_groups: body.age_groups } : {}),
      ...(body.languages !== undefined ? { languages: body.languages } : {}),
      access_tier: body.access_tier,
      ...(body.msv_only !== undefined ? { msv_only: body.msv_only } : {}),
      ...(body.city_id !== undefined ? { city_id: body.city_id } : {}),
    });
  }

  @Roles('sanchalak')
  @Delete('/admin/library/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    const actor = this.requireAuthed(user);
    await this.service.delete(actor, id);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private requireAuthed(user: CurrentUserPayload | undefined): { user_id: string; role: Role } {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    return { user_id: user.sub, role: user.role };
  }

  private async callerFrom(user: CurrentUserPayload | undefined): Promise<LibraryCaller> {
    if (!user) return { role: 'guest' };
    const caller: LibraryCaller = { role: user.role, user_id: user.sub };
    if (user.scope.city_id) caller.city_id = user.scope.city_id;
    if (user.role === 'parent') {
      caller.msv_visible = await this.service.resolveMsvVisibleForParent(user.sub);
    } else if (
      user.role === 'shikshak' ||
      user.role === 'sanchalak' ||
      user.role === 'city_admin' ||
      user.role === 'state_admin' ||
      user.role === 'super_admin'
    ) {
      caller.msv_visible = true;
    }
    return caller;
  }
}
