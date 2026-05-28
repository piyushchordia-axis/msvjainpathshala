import { Module } from '@nestjs/common';

import {
  BatchesRepository,
  CentresRepository,
  SanchalakAssignmentsRepository,
  SessionCancellationsRepository,
  SessionsRepository,
} from '../../db/repositories';
import { AuditModule } from '../audit/audit.module';

import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [AuditModule],
  controllers: [SessionsController],
  providers: [
    SessionsService,
    SessionsRepository,
    BatchesRepository,
    CentresRepository,
    SanchalakAssignmentsRepository,
    SessionCancellationsRepository,
  ],
  exports: [SessionsService, SessionsRepository],
})
export class SessionsModule {}
