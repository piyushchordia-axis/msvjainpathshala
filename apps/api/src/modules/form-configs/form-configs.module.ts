import { Module } from '@nestjs/common';

import { FormConfigsController } from './form-configs.controller';
import { FormConfigsService } from './form-configs.service';

@Module({
  controllers: [FormConfigsController],
  providers: [FormConfigsService],
  exports: [FormConfigsService],
})
export class FormConfigsModule {}
