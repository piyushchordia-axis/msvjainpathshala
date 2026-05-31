import { Global, Module } from '@nestjs/common';

import { SystemConfigRepository } from '../../db/repositories/system-config.repository';

import { SystemConfigService } from './system-config.service';

/**
 * Global module — every other module DI-injects `SystemConfigService` from
 * here. Imports the DatabaseModule + RedisModule via Nest's `@Global()` of
 * those (already done in Step 3).
 */
@Global()
@Module({
  providers: [SystemConfigRepository, SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
