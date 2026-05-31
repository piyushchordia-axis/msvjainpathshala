/**
 * MediaController — `/v1/media/*` (SPEC §6.24).
 *
 *   POST /v1/media/sign-upload  →  presigned PUT + asset_id (status=pending)
 *   POST /v1/media/finalize     →  HEAD + transition to processing + enqueue
 *   GET  /v1/media/:assetId     →  scope-checked signed URL (or public URL)
 *
 * All routes require authentication (JwtAuthGuard is global). The service
 * layer does kind→role and ownership checks; the controller only marshals.
 */

import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';

import {
  AppError,
  ERROR_CODES,
  MEDIA_KINDS,
  finalizeUploadSchema,
  presignUploadRequestSchema,
} from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';

import { MediaService } from './media.service';

import type { MediaKind } from '@jp/shared';

const signSchema = presignUploadRequestSchema.extend({
  kind: z.enum(MEDIA_KINDS),
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

@Controller('/v1/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  // ---- POST /v1/media/sign-upload -------------------------------------
  @Post('/sign-upload')
  @HttpCode(200)
  async signUpload(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(signSchema)) body: z.infer<typeof signSchema>,
  ) {
    assertActor(user);
    return this.media.signUpload(
      { user_id: user.sub, role: user.role },
      {
        kind: body.kind as MediaKind,
        mime_type: body.mime_type,
        size_bytes: body.size_bytes,
        ...(body.checksum_sha256 ? { checksum_sha256: body.checksum_sha256 } : {}),
      },
    );
  }

  // ---- POST /v1/media/finalize ----------------------------------------
  @Post('/finalize')
  @HttpCode(200)
  async finalize(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(finalizeUploadSchema)) body: z.infer<typeof finalizeUploadSchema>,
  ) {
    assertActor(user);
    const asset = await this.media.finalize(
      { user_id: user.sub, role: user.role },
      { asset_id: body.asset_id, checksum_sha256: body.checksum_sha256 },
    );
    return {
      id: asset.id,
      status: asset.status,
      kind: asset.kind,
    };
  }

  // ---- GET /v1/media/:assetId -----------------------------------------
  @Get('/:assetId')
  async getOne(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
  ) {
    assertActor(user);
    return this.media.getReadDescriptor({ user_id: user.sub, role: user.role }, assetId);
  }
}
