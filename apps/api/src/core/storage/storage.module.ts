/**
 * StorageModule — wires StorageService as a global provider.
 *
 * Loaded by both the HTTP root (AppModule) and the worker root
 * (WorkerModule) so producers (sign-upload / finalize endpoints) and
 * consumers (media.processing, idcard.generation workers) share the same
 * adapter configuration.
 */

import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module';

import { StorageService } from './storage.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
