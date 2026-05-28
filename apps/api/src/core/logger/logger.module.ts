import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import { AppConfigService } from '../config/app-config.service';
import { ConfigModule } from '../config/config.module';

import { buildNestjsPinoParams } from './pino.config';

/**
 * Wires nestjs-pino into the app with the per-env Pino config built from
 * `AppConfigService` (so log level / pretty mode follow NODE_ENV).
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => buildNestjsPinoParams(config),
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
