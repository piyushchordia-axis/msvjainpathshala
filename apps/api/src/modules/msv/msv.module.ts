import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';

import { MsvController } from './msv.controller';
import { MsvService } from './msv.service';

@Module({
  imports: [AuditModule],
  controllers: [MsvController],
  providers: [MsvService],
  exports: [MsvService],
})
export class MsvModule {}
