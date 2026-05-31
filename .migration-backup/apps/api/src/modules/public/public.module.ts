/**
 * PublicModule — unauthenticated public-website content reads (SPEC §6.26).
 * Registered via CentresModule's imports so it joins the app graph.
 */

import { Module } from '@nestjs/common';

import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
