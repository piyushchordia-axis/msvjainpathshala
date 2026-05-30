import { Module } from '@nestjs/common';

import { PublicModule } from '../public/public.module';

import { CentresController } from './centres.controller';
import { CentresService } from './centres.service';

@Module({
  imports: [PublicModule],
  controllers: [CentresController],
  providers: [CentresService],
  exports: [CentresService],
})
export class CentresModule {}
