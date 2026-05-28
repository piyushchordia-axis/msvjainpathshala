/**
 * MediaModule — wires the `/v1/media/*` routes (Step 11).
 *
 * Producer-side only. The matching @Processor for `media.processing`
 * lives in `apps/api/src/queues/processors/media-processing.processor.ts`
 * and is registered by `QueueProcessorsModule` (worker process).
 */

import { Module } from '@nestjs/common';

import { MediaAssetsRepository } from '../../db/repositories';

import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService, MediaAssetsRepository],
  exports: [MediaService, MediaAssetsRepository],
})
export class MediaModule {}
