import { Module } from '@nestjs/common';

import { CentreHolidaysController } from './centre-holidays.controller';
import { CentreHolidaysService } from './centre-holidays.service';

@Module({
  controllers: [CentreHolidaysController],
  providers: [CentreHolidaysService],
  exports: [CentreHolidaysService],
})
export class CentreHolidaysModule {}
