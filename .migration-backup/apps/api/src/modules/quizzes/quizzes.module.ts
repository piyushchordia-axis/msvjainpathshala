/**
 * QuizzesModule — Step 20 (SPEC §5.14, §6.18, §9.4).
 *
 * Three services under one module:
 *   - QuestionsService     reusable bank + AI generation lifecycle
 *   - QuizEventsService    scheduled time-windowed quizzes
 *   - PushQuizzesService   live in-class quizzes via Socket.IO
 *
 * Dependencies:
 *   - AuditModule for audit.emit()
 *   - PunyaModule for award() (participation, top score, completion)
 *   - RealtimeModule (global) for the Socket.IO gateway
 *   - BullMQ queues registered globally (notably AI_QUIZ_GENERATE)
 */

import { Module } from '@nestjs/common';

import {
  PushQuizzesRepository,
  QuestionsRepository,
  QuizEventsRepository,
  StudentsRepository,
} from '../../db/repositories';
import { AuditModule } from '../audit/audit.module';
import { PunyaModule } from '../punya/punya.module';

import { PushQuizzesService } from './push-quizzes.service';
import { QuestionsService } from './questions.service';
import { QuizEventsService } from './quiz-events.service';
import { QuizzesController } from './quizzes.controller';

@Module({
  imports: [AuditModule, PunyaModule],
  controllers: [QuizzesController],
  providers: [
    QuestionsService,
    QuizEventsService,
    PushQuizzesService,
    QuestionsRepository,
    QuizEventsRepository,
    PushQuizzesRepository,
    StudentsRepository,
  ],
  exports: [QuestionsService, QuizEventsService, PushQuizzesService],
})
export class QuizzesModule {}
