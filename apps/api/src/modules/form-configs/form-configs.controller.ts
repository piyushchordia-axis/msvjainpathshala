/**
 * FormConfigsController — persona-based resolution + super_admin / city_admin
 * authoring.
 *
 *   GET    /v1/form-configs/:persona?city_id=...
 *   POST   /v1/form-configs
 *
 * The Step 6 prompt names the persona dimension as `:persona`. Internally
 * we store it on `registration_form_configs.form_kind` (TEXT, so we can
 * widen beyond the original 3-value spec without a migration).
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { FormConfigsService } from './form-configs.service';

const ALLOWED_PERSONAS = ['student', 'parent', 'shikshak', 'sanchalak', 'city_admin'] as const;
const personaSchema = z.enum(ALLOWED_PERSONAS);

const createSchema = z.object({
  city_id: z.string().uuid().nullable().optional(),
  form_kind: personaSchema,
  base_field_overrides: z.unknown().optional(),
  custom_fields: z.unknown().optional(),
});

@Controller('/v1/form-configs')
export class FormConfigsController {
  constructor(private readonly service: FormConfigsService) {}

  /**
   * Public so the unauthenticated registration screen can fetch the right
   * form for the persona/city combination.
   */
  @Public()
  @Get('/:persona')
  async resolve(@Param('persona') persona: string, @Query('city_id') cityId?: string) {
    const parsed = personaSchema.safeParse(persona);
    if (!parsed.success) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: `Unknown persona '${persona}'`,
        statusCode: 422,
        details: [{ path: 'persona', meta: { allowed: ALLOWED_PERSONAS } }],
      });
    }
    return this.service.resolve(parsed.data, cityId);
  }

  @Roles('city_admin')
  @Post('/')
  @HttpCode(201)
  async create(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    return this.service.create(
      { user_id: user.sub, role: user.role },
      {
        city_id: body.city_id ?? null,
        form_kind: body.form_kind,
        base_field_overrides: body.base_field_overrides,
        custom_fields: body.custom_fields,
      },
    );
  }
}

type _RoleAlias = Role;
