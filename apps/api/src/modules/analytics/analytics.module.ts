/**
 * AnalyticsModule — Step 22 (SPEC §6.25, §12).
 *
 * Wires read endpoints over the six materialised views from migration
 * 0017. Refresh is owned by the analytics.refresh_views cron worker.
 */

import { Module } from '@nestjs/common';

import { AnalyticsRepository } from '../../db/repositories/analytics.repository';
import { ServiceRequestsRepository } from '../../db/repositories/service-requests.repository';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsRepository, ServiceRequestsRepository],
  exports: [AnalyticsService, AnalyticsRepository],
})
export class AnalyticsModule {}
