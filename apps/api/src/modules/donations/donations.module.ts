/**
 * DonationsModule — Step 21 (SPEC §5.17, §6.21, §8.8).
 *
 * Owns:
 *   - DonationsController (orders/verify/webhook/admin/platform-settings)
 *   - DonationsService
 *   - PlatformSettingsService (Q3 80G toggle)
 *   - PanEncryptionService (AES-256-GCM at the application layer)
 *   - RazorpayService (REST + signature verification)
 *
 * The downstream workers (donation.receipt.generate, donation.eightyg.cert)
 * live under apps/api/src/queues/processors and are mounted in
 * QueueProcessorsModule.
 */

import { Module } from '@nestjs/common';

import { DonationsRepository } from '../../db/repositories/donations.repository';
import { PlatformSettingsRepository } from '../../db/repositories/platform-settings.repository';
import { AuditModule } from '../audit/audit.module';

import { DonationsController } from './donations.controller';
import { DonationsService } from './donations.service';
import { PanEncryptionService } from './pan-encryption.service';
import { PlatformSettingsService } from './platform-settings.service';
import { RazorpayService } from './razorpay.service';

@Module({
  imports: [AuditModule],
  controllers: [DonationsController],
  providers: [
    DonationsService,
    PlatformSettingsService,
    PanEncryptionService,
    RazorpayService,
    DonationsRepository,
    PlatformSettingsRepository,
  ],
  exports: [
    DonationsService,
    PlatformSettingsService,
    PanEncryptionService,
    DonationsRepository,
    PlatformSettingsRepository,
  ],
})
export class DonationsModule {}
