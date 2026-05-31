/**
 * CentreHolidaysController — sanchalak+ scoped CRUD over centre_holidays.
 */

import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { RequireScope } from '../auth/decorators/require-scope.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { CentreHolidaysService } from './centre-holidays.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

const createSchema = z.object({
  name: z.string().min(1).max(200),
  start_date: isoDate,
  end_date: isoDate,
});

const querySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

@Controller('/v1/centres/:centreId/holidays')
export class CentreHolidaysController {
  constructor(private readonly service: CentreHolidaysService) {}

  @RequireScope('centre', 'centreId')
  @Get('/')
  async list(
    @Param('centreId') centreId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const q = querySchema.parse({ from, to });
    return { items: await this.service.list(centreId, q) };
  }

  @Roles('sanchalak')
  @RequireScope('centre', 'centreId')
  @Post('/')
  @HttpCode(201)
  async create(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('centreId') centreId: string,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    return this.service.create({ user_id: user.sub, role: user.role }, centreId, body);
  }

  @Roles('sanchalak')
  @RequireScope('centre', 'centreId')
  @Delete('/:holidayId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('centreId') centreId: string,
    @Param('holidayId') holidayId: string,
  ): Promise<void> {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    await this.service.delete({ user_id: user.sub, role: user.role }, centreId, holidayId);
  }
}

type _RoleAlias = Role;
