/**
 * QueueProcessorsModule — worker-side wiring of every @Processor.
 *
 * Mounted ONLY by `WorkerModule` (i.e. when `apps/api` runs as
 * `pnpm dev:worker` / `node dist/worker.js`). The HTTP entrypoint mounts
 * only the producer side via `QueuesModule.forRoot()`.
 *
 * As more processors land (notifications.* in Step 12, media.processing
 * in Step 11, etc.) they get added here. The `@Processor` decorator on
 * each class wires it to its queue name via @nestjs/bullmq.
 */

import { Module } from '@nestjs/common';

import { RedisModule } from '../core/redis/redis.module';

import { DebugEchoProcessor } from './processors/debug-echo.processor';

@Module({
  imports: [RedisModule],
  providers: [DebugEchoProcessor],
  exports: [DebugEchoProcessor],
})
export class QueueProcessorsModule {}
