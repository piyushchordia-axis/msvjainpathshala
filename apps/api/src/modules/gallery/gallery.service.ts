/**
 * GalleryService — Step 17 (SPEC §5.9, §6.11, CLAUDE.md Q6).
 *
 * Responsibilities:
 *
 *   1. Public read: GET /v1/gallery — strips PII to first_name + age_group
 *      + city only. NO parent info, NO full name.
 *
 *   2. Admin actions: feature / unfeature / remove. All audit-logged.
 *      Remove notifies the parent + requires a reason ≥ 20 chars.
 *
 *   3. PATCH /v1/profile/gallery-visibility — Q6: blanket per-parent toggle.
 *      true→false bulk-hides ALL existing items belonging to this parent's
 *      children (only those that weren't admin-removed). false→true restores
 *      them. Returns the new opt-in flag + count touched.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { GalleryItemsRepository, StudentsRepository, UsersRepository } from '../../db/repositories';
import { QUEUES } from '../../queues/queues.constants';
import { AuditService } from '../audit/audit.service';

import type { GalleryItem } from '../../db/schema';

export interface PublicGalleryItem {
  id: string;
  asset_id: string;
  is_featured: boolean;
  created_at: string;
  /** First name only — never full name (privacy). */
  first_name: string;
  age_group: string;
  niyam_id: string;
  niyam_title_en: string;
  niyam_title_hi: string;
  niyam_type: string;
}

export interface AdminGalleryItem extends PublicGalleryItem {
  removed: boolean;
  removed_by: string | null;
  student_id: string;
  centre_id: string;
  city_id: string;
}

export interface GalleryActor {
  user_id: string;
  role: Role;
  city_id?: string;
  centre_ids?: string[];
}

@Injectable()
export class GalleryService {
  private readonly logger = new Logger(GalleryService.name);

  constructor(
    private readonly gallery: GalleryItemsRepository,
    private readonly users: UsersRepository,
    private readonly students: StudentsRepository,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.NOTIFICATIONS_FANOUT)
    private readonly fanoutQueue: Queue,
  ) {}

  // ===========================================================================
  // Public read
  // ===========================================================================

  /**
   * Public gallery listing. Strips PII before returning. featured items are
   * forced to the top (the repo does that with the ORDER BY).
   */
  async listPublic(opts: {
    city_id?: string;
    featured?: boolean;
    age_group?: string;
    niyam_type?: 'daily' | 'weekly' | 'monthly';
    limit?: number;
    offset?: number;
  }): Promise<{ items: PublicGalleryItem[] }> {
    const rows = await this.gallery.listPublic(opts);
    const items: PublicGalleryItem[] = rows.map((r) => ({
      id: r.item.id,
      asset_id: r.item.asset_id,
      is_featured: r.item.is_featured,
      created_at: r.item.created_at.toISOString(),
      first_name: firstName(r.student.full_name),
      age_group: r.student.age_group,
      niyam_id: r.niyam.id,
      niyam_title_en: r.niyam.title_en,
      niyam_title_hi: r.niyam.title_hi,
      niyam_type: r.niyam.type,
    }));
    return { items };
  }

  // ===========================================================================
  // Admin actions
  // ===========================================================================

  async listForAdmin(
    actor: GalleryActor,
    opts: { status?: 'visible' | 'removed' | 'featured'; limit?: number; offset?: number },
  ): Promise<{ items: AdminGalleryItem[] }> {
    this.assertAdminRole(actor);
    const scopedOpts: Parameters<GalleryItemsRepository['listForAdmin']>[0] = {
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      ...(opts.offset !== undefined ? { offset: opts.offset } : {}),
    };
    // sanchalak is centre-bound; city_admin is city-bound; super/state see all
    if (actor.role === 'sanchalak') scopedOpts.centre_ids = actor.centre_ids ?? [];
    if (actor.role === 'city_admin' && actor.city_id) scopedOpts.city_id = actor.city_id;

    const rows = await this.gallery.listForAdmin(scopedOpts);
    const items: AdminGalleryItem[] = rows.map((r) => ({
      id: r.item.id,
      asset_id: r.item.asset_id,
      is_featured: r.item.is_featured,
      created_at: r.item.created_at.toISOString(),
      first_name: firstName(r.student.full_name),
      age_group: r.student.age_group,
      niyam_id: r.niyam.id,
      niyam_title_en: r.niyam.title_en,
      niyam_title_hi: r.niyam.title_hi,
      niyam_type: r.niyam.type,
      removed: r.item.removed,
      removed_by: r.item.removed_by,
      student_id: r.student.id,
      centre_id: r.item.centre_id,
      city_id: r.item.city_id,
    }));
    return { items };
  }

  async feature(actor: GalleryActor, id: string): Promise<GalleryItem> {
    this.assertAdminRole(actor);
    const before = await this.gallery.findById(id);
    if (!before) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Gallery item not found',
        statusCode: 404,
      });
    }
    await this.assertActorReach(actor, before);
    const row = await this.gallery.setFeatured(id, true, actor.user_id);
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.ERR_INTERNAL,
        message: 'Gallery feature failed',
        statusCode: 500,
      });
    }
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'feature',
        entity_kind: 'gallery_item',
        entity_id: id,
        before: { is_featured: before.is_featured },
        after: { is_featured: true },
      })
      .catch(() => undefined);
    return row;
  }

  async unfeature(actor: GalleryActor, id: string): Promise<GalleryItem> {
    this.assertAdminRole(actor);
    const before = await this.gallery.findById(id);
    if (!before) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Gallery item not found',
        statusCode: 404,
      });
    }
    await this.assertActorReach(actor, before);
    const row = await this.gallery.setFeatured(id, false, actor.user_id);
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.ERR_INTERNAL,
        message: 'Gallery unfeature failed',
        statusCode: 500,
      });
    }
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'unfeature',
        entity_kind: 'gallery_item',
        entity_id: id,
        before: { is_featured: before.is_featured },
        after: { is_featured: false },
      })
      .catch(() => undefined);
    return row;
  }

  /**
   * Admin remove — distinct from the parent opt-out path. Records who
   * removed it; the parent's opt-in toggle will NOT bring it back.
   */
  async remove(actor: GalleryActor, id: string, reason: string): Promise<GalleryItem> {
    this.assertAdminRole(actor);
    if (!reason || reason.trim().length < 20) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'remove reason must be at least 20 characters',
        statusCode: 422,
      });
    }
    const before = await this.gallery.findById(id);
    if (!before) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Gallery item not found',
        statusCode: 404,
      });
    }
    await this.assertActorReach(actor, before);
    const row = await this.gallery.adminRemove(id, actor.user_id);
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.ERR_INTERNAL,
        message: 'Gallery remove failed',
        statusCode: 500,
      });
    }
    // Notify the parent of the removal.
    const student = await this.students.findById(before.student_id);
    if (student) {
      await this.fanoutQueue
        .add('gallery.item.removed', {
          event: 'gallery.item.removed',
          recipient_user_ids: [student.parent_user_id],
          source: { kind: 'gallery_item', id },
          data: {
            student_id: student.id,
            gallery_item_id: id,
            reason,
          },
          deep_link: `/students/${student.id}/gallery`,
        })
        .catch(() => undefined);
    }
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'delete',
        entity_kind: 'gallery_item',
        entity_id: id,
        before: { removed: false },
        after: { removed: true, reason },
      })
      .catch(() => undefined);
    return row;
  }

  // ===========================================================================
  // Parent visibility toggle (Q6)
  // ===========================================================================

  /**
   * Q6 — single per-parent blanket toggle. Backfills:
   *   - true→false: hides every visible item belonging to this parent's
   *     children (only those NOT admin-removed; admin removals stay).
   *   - false→true: restores items that were hidden by the opt-out path.
   */
  async setGalleryVisibility(
    actor: GalleryActor,
    optIn: boolean,
  ): Promise<{
    gallery_visibility_opt_in: boolean;
    items_hidden: number;
    items_restored: number;
  }> {
    if (actor.role !== 'parent') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only parents can change the gallery visibility opt-in',
        statusCode: 403,
      });
    }
    const before = await this.users.findById(actor.user_id);
    if (!before) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'User not found',
        statusCode: 404,
      });
    }

    let itemsHidden = 0;
    let itemsRestored = 0;
    if (before.gallery_visibility_opt_in !== optIn) {
      if (optIn) {
        itemsRestored = await this.gallery.parentOptInRestore(actor.user_id);
      } else {
        itemsHidden = await this.gallery.parentOptOutBulk(actor.user_id);
      }
    }

    await this.users.update(actor.user_id, { gallery_visibility_opt_in: optIn });

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'update',
        entity_kind: 'gallery_visibility',
        entity_id: actor.user_id,
        before: { gallery_visibility_opt_in: before.gallery_visibility_opt_in },
        after: {
          gallery_visibility_opt_in: optIn,
          items_hidden: itemsHidden,
          items_restored: itemsRestored,
        },
      })
      .catch(() => undefined);

    return {
      gallery_visibility_opt_in: optIn,
      items_hidden: itemsHidden,
      items_restored: itemsRestored,
    };
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private assertAdminRole(actor: GalleryActor): void {
    const allowed: Role[] = ['super_admin', 'state_admin', 'city_admin', 'sanchalak'];
    if (!allowed.includes(actor.role)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only sanchalak / city_admin+ can manage gallery items',
        statusCode: 403,
      });
    }
  }

  private async assertActorReach(actor: GalleryActor, item: GalleryItem): Promise<void> {
    if (actor.role === 'super_admin' || actor.role === 'state_admin') return;
    if (actor.role === 'city_admin') {
      if (actor.city_id === item.city_id) return;
    }
    if (actor.role === 'sanchalak') {
      if ((actor.centre_ids ?? []).includes(item.centre_id)) return;
    }
    throw new AppError({
      code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
      message: 'Item is outside your scope',
      statusCode: 403,
    });
  }
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}
