/**
 * PublicController — `/v1/public/*` (SPEC §6.26). All routes @Public; only
 * non-sensitive, active content is exposed. Backs the public website.
 */

import { Controller, Get, Param } from '@nestjs/common';

import { Public } from '../auth/decorators/public.decorator';

import { PublicService } from './public.service';

@Controller('/v1/public')
export class PublicController {
  constructor(private readonly service: PublicService) {}

  @Public()
  @Get('/centres')
  async centres() {
    return this.service.listCentres();
  }

  @Public()
  @Get('/centres/:id')
  async centre(@Param('id') id: string) {
    return this.service.getCentre(id);
  }

  @Public()
  @Get('/shivirs')
  async shivirs() {
    return this.service.listShivirs();
  }

  @Public()
  @Get('/shivirs/:id')
  async shivir(@Param('id') id: string) {
    return this.service.getShivir(id);
  }
}
