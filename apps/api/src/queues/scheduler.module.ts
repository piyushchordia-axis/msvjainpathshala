import { Module } from '@nestjs/common';

import { SchedulerService } from './scheduler.service';

/**
 * SchedulerModule — wraps SchedulerService so worker.module.ts can import it
 * without dragging in any other providers. QueuesModule.forRoot() must be
 * imported once at the app level so the @InjectQueue(...) tokens used by
 * SchedulerService resolve.
 */
@Module({
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
