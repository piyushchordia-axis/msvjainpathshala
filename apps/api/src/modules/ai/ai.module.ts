/**
 * AiModule — wires the FastAPI ↔ NestJS bridge for AI-generated questions.
 *
 * The outbound side (worker → FastAPI) is in
 * `apps/api/src/queues/processors/ai-quiz-generate.processor.ts` and uses
 * AppConfigService directly. The inbound side (FastAPI → NestJS callback)
 * is `AiBatchController` here, protected by `AiHmacGuard`.
 */

import { Module } from '@nestjs/common';

import { QuestionsRepository } from '../../db/repositories';

import { AiBatchController } from './ai-batch.controller';
import { AiHmacGuard } from './ai-hmac.guard';

@Module({
  controllers: [AiBatchController],
  providers: [AiHmacGuard, QuestionsRepository],
  exports: [AiHmacGuard],
})
export class AiModule {}
