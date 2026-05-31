import { Module } from '@nestjs/common';

import { RedisModule } from '../../core/redis/redis.module';
import { AuditModule } from '../audit/audit.module';

import { AdminQueuesController } from './admin-queues.controller';
import { AdminQueuesService } from './admin-queues.service';

/**
 * AdminQueuesModule — super_admin DLQ admin endpoints + the smoke
 * /v1/admin/debug/echo route. Loaded only by the HTTP app.
 */
@Module({
  imports: [RedisModule, AuditModule],
  controllers: [AdminQueuesController],
  providers: [AdminQueuesService],
  exports: [AdminQueuesService],
})
export class AdminQueuesModule {}
