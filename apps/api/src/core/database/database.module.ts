import { Global, Module } from '@nestjs/common';

import {
  BatchesRepository,
  CentreHolidaysRepository,
  CentresRepository,
  DeviceSessionsRepository,
  EnrolmentsRepository,
  FormConfigsRepository,
  GeographyRepository,
  MsvEnrolmentsRepository,
  PhoneOtpAttemptsRepository,
  PunyaFeaturesRepository,
  PunyaTransactionsRepository,
  RefreshTokenFamiliesRepository,
  SanchalakAssignmentsRepository,
  ShikshakAssignmentsRepository,
  StudentsRepository,
  SystemConfigRepository,
  UsersRepository,
} from '../../db/repositories';
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

const REPOSITORIES = [
  UsersRepository,
  BatchesRepository,
  PunyaFeaturesRepository,
  PunyaTransactionsRepository,
  DeviceSessionsRepository,
  PhoneOtpAttemptsRepository,
  RefreshTokenFamiliesRepository,
  SystemConfigRepository,
  GeographyRepository,
  CentresRepository,
  CentreHolidaysRepository,
  SanchalakAssignmentsRepository,
  ShikshakAssignmentsRepository,
  FormConfigsRepository,
  StudentsRepository,
  EnrolmentsRepository,
  MsvEnrolmentsRepository,
] as const;

/**
 * Global database module — constructs the read + write Postgres clients ONCE,
 * exposes `DrizzleService`, and ships every repository in the @jp/api project.
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
    ...REPOSITORIES,
  ],
  exports: [DrizzleService, ...REPOSITORIES],
})
export class DatabaseModule {}
