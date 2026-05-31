/**
 * GeographyController — public reads + super_admin / state_admin writes
 * (SPEC §6.2; Step 6 prompt).
 *
 * Public reads use @Public() so the unauthenticated app shell (login screen,
 * city picker) can load these without a token.
 */

import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { GeographyService } from './geography.service';

const createStateSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(2).max(8),
});

const createCitySchema = z.object({
  state_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  code: z.string().min(2).max(8),
});

@Controller('/v1/geography')
export class GeographyController {
  constructor(private readonly geography: GeographyService) {}

  @Public()
  @Get('/states')
  async listStates() {
    return { items: await this.geography.listStates() };
  }

  @Public()
  @Get('/states/:stateId/cities')
  async listCities(@Param('stateId') stateId: string) {
    return { items: await this.geography.listCitiesByState(stateId) };
  }

  @Public()
  @Get('/cities/:cityId')
  async getCity(@Param('cityId') cityId: string) {
    return this.geography.getCity(cityId);
  }

  @Roles('super_admin')
  @Post('/states')
  @HttpCode(201)
  async createState(
    @Body(new ZodValidationPipe(createStateSchema)) body: z.infer<typeof createStateSchema>,
  ) {
    return this.geography.createState(body);
  }

  @Roles('state_admin')
  @Post('/cities')
  @HttpCode(201)
  async createCity(
    @Body(new ZodValidationPipe(createCitySchema)) body: z.infer<typeof createCitySchema>,
  ) {
    return this.geography.createCity(body);
  }
}
