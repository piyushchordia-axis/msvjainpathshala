/**
 * ServiceRequestsModule — Step 22 (SPEC §5.15, §6.19).
 */

import { Module } from '@nestjs/common';

import {
  CentresRepository,
  SanchalakAssignmentsRepository,
  ServiceRequestsRepository,
  StudentsRepository,
} from '../../db/repositories';
import { AuditModule } from '../audit/audit.module';

import { ServiceRequestsController } from './service-requests.controller';
import { ServiceRequestsService } from './service-requests.service';

@Module({
  imports: [AuditModule],
  controllers: [ServiceRequestsController],
  providers: [
    ServiceRequestsService,
    ServiceRequestsRepository,
    StudentsRepository,
    CentresRepository,
    SanchalakAssignmentsRepository,
  ],
  exports: [ServiceRequestsService, ServiceRequestsRepository],
})
export class ServiceRequestsModule {}
