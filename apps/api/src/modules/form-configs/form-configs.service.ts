/**
 * FormConfigsService — persona resolution with city override.
 *
 *   GET /v1/form-configs/:persona[?city_id=X]
 *     1. If city_id provided → look up city-specific active config first.
 *     2. Fall back to the global default (city_id IS NULL).
 *     3. 404 if neither exists.
 *
 * Cache TTL: 1h per Step 6 prompt + SPEC §17.2.
 *   Key: cache:form-configs:{persona}:{city_id|default}
 *
 * Writes (super_admin / city_admin) invalidate the matching key.
 */

import { Injectable } from '@nestjs/common';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { RedisService } from '../../core/redis/redis.service';
import { FormConfigsRepository } from '../../db/repositories';
import { AuditService } from '../audit/audit.service';

import type { NewRegistrationFormConfig, RegistrationFormConfig } from '../../db/schema';

const TTL_SECONDS = 60 * 60;
const cacheKey = (persona: string, cityId: string | null): string =>
  `cache:form-configs:${persona}:${cityId ?? 'default'}`;

export interface FormConfigsActor {
  user_id: string;
  role: Role;
}

@Injectable()
export class FormConfigsService {
  constructor(
    private readonly repo: FormConfigsRepository,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async resolve(persona: string, cityId?: string): Promise<RegistrationFormConfig> {
    const effectiveCityId = cityId ?? null;
    const cached = await this.redis.cacheClient.get(cacheKey(persona, effectiveCityId));
    if (cached) {
      try {
        return JSON.parse(cached) as RegistrationFormConfig;
      } catch {
        // fall through
      }
    }

    let row: RegistrationFormConfig | null = null;
    if (effectiveCityId !== null) {
      row = await this.repo.findActiveByCityAndKind(effectiveCityId, persona);
    }
    if (!row) {
      row = await this.repo.findActiveDefaultByKind(persona);
    }
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: `No active form config for persona='${persona}'`,
        statusCode: 404,
      });
    }
    await this.redis.cacheClient.set(
      cacheKey(persona, effectiveCityId),
      JSON.stringify(row),
      'EX',
      TTL_SECONDS,
    );
    return row;
  }

  async create(
    actor: FormConfigsActor,
    input: {
      city_id: string | null;
      form_kind: string;
      base_field_overrides?: unknown;
      custom_fields?: unknown;
    },
  ): Promise<RegistrationFormConfig> {
    this.assertFieldShape(input.custom_fields);

    const version_no = await this.repo.nextVersionFor(input.city_id, input.form_kind);
    const payload: NewRegistrationFormConfig = {
      form_kind: input.form_kind,
      version_no,
      is_active: true,
      published_at: new Date(),
      published_by: actor.user_id,
      created_by: actor.user_id,
      updated_by: actor.user_id,
      ...(input.city_id !== null ? { city_id: input.city_id } : {}),
      ...(input.base_field_overrides !== undefined
        ? { base_field_overrides: input.base_field_overrides }
        : {}),
      ...(input.custom_fields !== undefined ? { custom_fields: input.custom_fields } : {}),
    };
    const row = await this.repo.create(payload);
    await this.redis.cacheClient.del(cacheKey(input.form_kind, input.city_id));
    await this.audit.emit({
      actor_user_id: actor.user_id,
      actor_role: actor.role,
      action: 'form_config.created',
      entity_kind: 'registration_form_config',
      entity_id: row.id,
      after: { city_id: input.city_id, form_kind: input.form_kind, version_no },
    });
    return row;
  }

  /**
   * Each custom field must declare at minimum: key, label_en, label_hi,
   * type, required. (Step 6 prompt — registration_form_configs validation.)
   *
   * Anything richer (validation rules, options, conditional show/hide) lives
   * inside the field object as extra properties — we don't constrain those
   * shapes here so cities can extend without a schema migration.
   */
  private assertFieldShape(customFields: unknown): void {
    if (customFields === undefined || customFields === null) return;
    if (!Array.isArray(customFields)) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'custom_fields must be a JSON array',
        statusCode: 422,
        details: [{ path: 'custom_fields' }],
      });
    }
    const allowedTypes = new Set([
      'text',
      'multiline',
      'number',
      'date',
      'select',
      'multiselect',
      'boolean',
      'phone',
      'email',
      'file',
    ]);
    for (let i = 0; i < customFields.length; i++) {
      const f = customFields[i];
      const ctx = `custom_fields[${i}]`;
      if (!f || typeof f !== 'object') {
        throw this.fieldError(ctx, 'must be an object');
      }
      const obj = f as Record<string, unknown>;
      const requireString = (name: string): void => {
        if (typeof obj[name] !== 'string' || (obj[name] as string).length === 0) {
          throw this.fieldError(`${ctx}.${name}`, 'must be a non-empty string');
        }
      };
      requireString('key');
      requireString('label_en');
      requireString('label_hi');
      requireString('type');
      if (!allowedTypes.has(obj['type'] as string)) {
        throw this.fieldError(`${ctx}.type`, `must be one of ${[...allowedTypes].join(', ')}`);
      }
      if (typeof obj['required'] !== 'boolean') {
        throw this.fieldError(`${ctx}.required`, 'must be a boolean');
      }
    }
  }

  private fieldError(path: string, message: string): AppError {
    return new AppError({
      code: ERROR_CODES.ERR_VALIDATION_FAILED,
      message: `custom_fields shape error: ${path}: ${message}`,
      statusCode: 422,
      details: [{ path }],
    });
  }
}
