/**
 * PlatformSettingsService — wraps the singleton-row repository with the
 * Q3 toggle invariants (CLAUDE.md "Critical business rules").
 *
 * Enabling 80G:
 *   - super_admin only (controller-side guard)
 *   - BOTH `eighty_g_registration_number` AND `eighty_g_trust_name` AND
 *     `eighty_g_trust_address` must be set in the same request. Missing
 *     any of them → ERR_DONATION_80G_PREREQS_MISSING (422).
 *   - Audit entry written via AuditService.
 *
 * Disabling 80G:
 *   - Existing certificates are NEVER deleted (CLAUDE.md Q3).
 *   - New donations stop getting the 80G cert job enqueued — handled by
 *     DonationsService reading `eighty_g_enabled` before enqueuing.
 */

import { Injectable } from '@nestjs/common';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { PlatformSettingsRepository } from '../../db/repositories/platform-settings.repository';
import { AuditService } from '../audit/audit.service';

import type { PlatformSettings } from '../../db/schema';

export interface UpdatePlatformSettingsInput {
  eighty_g_enabled?: boolean;
  eighty_g_registration_number?: string | null;
  eighty_g_trust_name?: string | null;
  eighty_g_trust_address?: string | null;
  eighty_g_section?: string;
}

export interface PlatformSettingsActor {
  user_id: string;
  role: Role;
}

@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly repo: PlatformSettingsRepository,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<PlatformSettings> {
    return this.repo.get();
  }

  async update(
    actor: PlatformSettingsActor,
    input: UpdatePlatformSettingsInput,
  ): Promise<PlatformSettings> {
    if (actor.role !== 'super_admin') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only super_admin can update platform settings',
        statusCode: 403,
      });
    }

    const existing = await this.repo.get();

    // Merge proposed values (use undefined-means-unchanged semantics).
    const next = {
      eighty_g_enabled: input.eighty_g_enabled ?? existing.eighty_g_enabled,
      eighty_g_registration_number:
        input.eighty_g_registration_number !== undefined
          ? input.eighty_g_registration_number
          : existing.eighty_g_registration_number,
      eighty_g_trust_name:
        input.eighty_g_trust_name !== undefined
          ? input.eighty_g_trust_name
          : existing.eighty_g_trust_name,
      eighty_g_trust_address:
        input.eighty_g_trust_address !== undefined
          ? input.eighty_g_trust_address
          : existing.eighty_g_trust_address,
      eighty_g_section: input.eighty_g_section ?? existing.eighty_g_section,
    };

    // Q3 invariant: toggling ON requires registration number + trust name + address.
    if (next.eighty_g_enabled) {
      const missing: string[] = [];
      if (!next.eighty_g_registration_number?.trim()) missing.push('eighty_g_registration_number');
      if (!next.eighty_g_trust_name?.trim()) missing.push('eighty_g_trust_name');
      if (!next.eighty_g_trust_address?.trim()) missing.push('eighty_g_trust_address');
      if (missing.length) {
        throw new AppError({
          code: ERROR_CODES.ERR_DONATION_80G_PREREQS_MISSING,
          message: `Cannot enable 80G — missing: ${missing.join(', ')}`,
          statusCode: 422,
          details: missing.map((field) => ({ field, message: 'required' })),
        });
      }
    }

    const updated = await this.repo.update(next, actor.user_id);

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'config_change',
        entity_kind: 'platform_settings',
        entity_id: 'global',
        before: {
          eighty_g_enabled: existing.eighty_g_enabled,
          eighty_g_registration_number: existing.eighty_g_registration_number,
        },
        after: {
          eighty_g_enabled: updated.eighty_g_enabled,
          eighty_g_registration_number: updated.eighty_g_registration_number,
        },
      })
      .catch(() => undefined);

    return updated;
  }
}
