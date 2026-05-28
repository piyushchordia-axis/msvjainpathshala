import { Global, Module } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';
import { ConfigModule } from '../config/config.module';

import {
  DRIZZLE_READ_TOKEN,
  DRIZZLE_WRITE_TOKEN,
  DrizzleService,
  PG_READ_TOKEN,
  PG_WRITE_TOKEN,
  buildPools,
} from './drizzle.service';

/**
 * Global database module — constructs the read + write Postgres clients ONCE
 * and exposes `DrizzleService` to the rest of the app.
 *
 * Both pools share a graceful-shutdown hook (DrizzleService.onModuleDestroy).
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'JP_POOLS',
      useFactory: (config: AppConfigService) => buildPools(config),
      inject: [AppConfigService],
    },
    {
      provide: PG_WRITE_TOKEN,
      useFactory: (pools: ReturnType<typeof buildPools>) => pools.pgWrite,
      inject: ['JP_POOLS'],
    },
    {
      provide: PG_READ_TOKEN,
      useFactory: (pools: ReturnType<typeof buildPools>) => pools.pgRead,
      inject: ['JP_POOLS'],
    },
    {
      provide: DRIZZLE_WRITE_TOKEN,
      useFactory: (pools: ReturnType<typeof buildPools>) => pools.dbWrite,
      inject: ['JP_POOLS'],
    },
    {
      provide: DRIZZLE_READ_TOKEN,
      useFactory: (pools: ReturnType<typeof buildPools>) => pools.dbRead,
      inject: ['JP_POOLS'],
    },
    DrizzleService,
  ],
  exports: [DrizzleService],
})
export class DatabaseModule {}
