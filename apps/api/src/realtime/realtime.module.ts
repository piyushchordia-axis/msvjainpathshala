/**
 * RealtimeModule — Socket.IO gateway + helper for emitting live events.
 *
 * Marked @Global so other modules can DI-inject `RealtimeGateway` without
 * extra import lines (the gateway is a singleton — there's only one IO
 * server per process).
 *
 * The actual Socket.IO server is bound to the HTTP server in `src/main.ts`
 * after `app.listen()` resolves. The worker process doesn't import this
 * module — workers aren't HTTP servers, they only enqueue.
 */

import { Global, Module } from '@nestjs/common';

import { AuthModule } from '../modules/auth/auth.module';

import { RealtimeGateway } from './realtime.gateway';

@Global()
@Module({
  imports: [AuthModule], // For JwtService
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
