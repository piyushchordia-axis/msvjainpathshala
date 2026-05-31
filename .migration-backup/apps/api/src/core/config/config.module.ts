import { Global, Module } from '@nestjs/common';

import { AppConfigService } from './app-config.service';
import { loadAndValidateEnv } from './env.schema';

/**
 * Global config module — runs the Zod validation ONCE at boot and provides
 * a typed `AppConfigService` everywhere via DI.
 *
 * Marked `@Global()` so feature modules don't have to import ConfigModule
 * themselves (and so the validated env is shared across the whole tree).
 */
@Global()
@Module({
  providers: [
    {
      provide: AppConfigService,
      useFactory: () => new AppConfigService(loadAndValidateEnv()),
    },
  ],
  exports: [AppConfigService],
})
export class ConfigModule {}
