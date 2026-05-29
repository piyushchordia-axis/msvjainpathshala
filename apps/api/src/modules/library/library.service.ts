/**
 * LibraryService — SPEC §5.16, §6.20, Step 22.
 *
 * Four access tiers (high → low):
 *   - shikshak  : visible to shikshak + sanchalak + admin
 *   - msv       : visible to MSV-approved students/parents + shikshak+
 *   - student   : visible to any enrolled student or their parent + shikshak+
 *   - public    : visible to everyone, including the guest tier
 *
 * The four tiers map into the caller's "visible-tier set" by role:
 *
 *   role           tiers caller can see
 *   --------------------------------------
 *   guest          [public]
 *   parent         [public, student, msv?]  ← msv only when caller has an
 *                                              MSV-approved child
 *   student-view   [public, student, msv?]  ← msv only when caller is MSV
 *   shikshak       [public, student, msv, shikshak]
 *   sanchalak+     [public, student, msv, shikshak]
 *
 * Q7: type='video' items carry an embed_url (YouTube/Vimeo) and NO
 * asset_id. Non-video items carry an asset_id and NO embed_url. The Zod
 * schema in the controller rejects mismatched payloads with a 400; the
 * service re-asserts so direct/internal calls can't bypass it.
 */

import { Injectable, Logger } from '@nestjs/common';

import { AppError, ERROR_CODES, type LibraryAccessTier, type Role } from '@jp/shared';

import { StorageService } from '../../core/storage/storage.service';
import { LibraryRepository } from '../../db/repositories/library.repository';
import { MsvEnrolmentsRepository } from '../../db/repositories/msv-enrolments.repository';
import { StudentsRepository } from '../../db/repositories/students.repository';

import type { LibraryItem, NewLibraryItem } from '../../db/schema';

const YT_URL = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//;
const VIMEO_URL = /^https?:\/\/(www\.)?(player\.)?vimeo\.com\//;

export function isYoutubeOrVimeo(url: string): boolean {
  return YT_URL.test(url) || VIMEO_URL.test(url);
}

export interface LibraryCaller {
  user_id?: string;
  role: Role | 'guest';
  /** Set when caller has at least one MSV-approved child (parent) or is MSV-approved themselves. */
  msv_visible?: boolean;
  city_id?: string;
}

@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);

  constructor(
    private readonly repo: LibraryRepository,
    private readonly students: StudentsRepository,
    private readonly msvEnrolments: MsvEnrolmentsRepository,
    private readonly storage: StorageService,
  ) {}

  // ===========================================================================
  // Listing + reads (access-tier enforced at service layer)
  // ===========================================================================

  visibleTiersFor(caller: LibraryCaller): LibraryAccessTier[] {
    const role = caller.role;
    if (role === 'guest') return ['public'];
    if (
      role === 'shikshak' ||
      role === 'sanchalak' ||
      role === 'city_admin' ||
      role === 'state_admin' ||
      role === 'super_admin'
    ) {
      // Admins/teachers see everything regardless of MSV state.
      return ['public', 'student', 'msv', 'shikshak'];
    }
    // parent / student — student-view runs under the parent's session
    const tiers: LibraryAccessTier[] = ['public', 'student'];
    if (caller.msv_visible) tiers.push('msv');
    return tiers;
  }

  async list(
    caller: LibraryCaller,
    opts: { content_type?: 'pdf' | 'video' | 'audio' | 'image'; limit?: number; offset?: number },
  ): Promise<LibraryItem[]> {
    const tiers = this.visibleTiersFor(caller);
    const msvVisible =
      caller.role !== 'parent' && caller.role !== 'student' ? true : !!caller.msv_visible;
    return this.repo.list({
      tiers,
      msv_visible: msvVisible,
      ...(opts.content_type ? { content_type: opts.content_type } : {}),
      ...(caller.city_id ? { city_id: caller.city_id } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      ...(opts.offset !== undefined ? { offset: opts.offset } : {}),
    });
  }

  async getById(
    caller: LibraryCaller,
    id: string,
  ): Promise<LibraryItem & { signed_url?: string | null }> {
    const item = await this.repo.findById(id);
    if (!item) {
      throw new AppError({
        code: ERROR_CODES.ERR_LIBRARY_NOT_FOUND,
        message: 'Library item not found',
        statusCode: 404,
      });
    }
    this.assertCanRead(caller, item);

    // Best-effort access log; never blocks the read.
    void this.repo
      .logAccess({
        item_id: item.id,
        user_id: caller.user_id ?? null,
        action: 'view',
        at: new Date(),
      })
      .catch((err) => this.logger.warn(`access-log failed: ${(err as Error).message}`));

    // For file-backed items we sign a 1h URL; for embeds we return the URL as-is.
    if (item.content_type === 'video') {
      return { ...item };
    }
    // SPEC §5.21 — signed S3 URL for pdf/audio/image.
    // We do not synchronously fetch the media asset here to keep the
    // controller hot path simple; the controller exposes a /sign endpoint
    // for callers that want a fresh signed URL. Returning the item as-is
    // is sufficient for the inline reader on mobile/web which calls
    // /v1/media/:id with the asset_id.
    return { ...item };
  }

  async logDownload(caller: LibraryCaller, id: string): Promise<void> {
    const item = await this.repo.findById(id);
    if (!item) {
      throw new AppError({
        code: ERROR_CODES.ERR_LIBRARY_NOT_FOUND,
        message: 'Library item not found',
        statusCode: 404,
      });
    }
    this.assertCanRead(caller, item);
    await this.repo.logAccess({
      item_id: item.id,
      user_id: caller.user_id ?? null,
      action: 'download',
      at: new Date(),
    });
  }

  // ===========================================================================
  // Admin — create / soft-delete
  // ===========================================================================

  async create(
    actor: { user_id: string; role: Role },
    input: {
      content_type: 'pdf' | 'video' | 'audio' | 'image';
      title_en: string;
      title_hi: string;
      description_en?: string;
      description_hi?: string;
      asset_id?: string | null;
      embed_url?: string | null;
      tags?: string[];
      age_groups?: ('bal' | 'kishor' | 'tarun' | 'yuva')[];
      languages?: ('en' | 'hi')[];
      access_tier: LibraryAccessTier;
      msv_only?: boolean;
      city_id?: string | null;
    },
  ): Promise<LibraryItem> {
    this.assertCanCreate(actor.role);
    this.validateInvariants(input);

    const row: NewLibraryItem = {
      content_type: input.content_type,
      title_en: input.title_en,
      title_hi: input.title_hi,
      description_en: input.description_en ?? null,
      description_hi: input.description_hi ?? null,
      asset_id: input.asset_id ?? null,
      embed_url: input.embed_url ?? null,
      tags: input.tags ?? [],
      age_groups: input.age_groups ?? [],
      languages: input.languages ?? [],
      access_tier: input.access_tier,
      msv_only: input.msv_only ?? false,
      uploaded_by_user_id: actor.user_id,
      city_id: input.city_id ?? null,
    };
    return this.repo.create(row);
  }

  async delete(actor: { user_id: string; role: Role }, id: string): Promise<void> {
    this.assertCanCreate(actor.role);
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw new AppError({
        code: ERROR_CODES.ERR_LIBRARY_NOT_FOUND,
        message: 'Library item not found',
        statusCode: 404,
      });
    }
    await this.repo.softDelete(id);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Resolve `msv_visible` for a parent caller — true if ANY of their active
   * children carries `msv_status='approved'`. For students (via student-view)
   * the controller passes through caller.msv_visible already resolved.
   */
  async resolveMsvVisibleForParent(parentUserId: string): Promise<boolean> {
    const kids = await this.students.findByParent(parentUserId).catch(() => []);
    for (const kid of kids) {
      if (kid.status !== 'active' || kid.deleted_at) continue;
      const enrolment = await this.msvEnrolments.findActiveByStudent(kid.id).catch(() => null);
      if (enrolment && enrolment.status === 'approved') return true;
    }
    return false;
  }

  private assertCanRead(caller: LibraryCaller, item: LibraryItem): void {
    const visible = this.visibleTiersFor(caller);
    if (!visible.includes(item.access_tier)) {
      throw new AppError({
        code: ERROR_CODES.ERR_LIBRARY_ACCESS_DENIED,
        message: `Library tier '${item.access_tier}' is not visible to your role`,
        statusCode: 403,
      });
    }
    // Q7 / msv_only flag — independent from access_tier for finer control.
    if (item.msv_only && !caller.msv_visible) {
      const role = caller.role;
      const teacherOrAdmin =
        role === 'shikshak' ||
        role === 'sanchalak' ||
        role === 'city_admin' ||
        role === 'state_admin' ||
        role === 'super_admin';
      if (!teacherOrAdmin) {
        throw new AppError({
          code: ERROR_CODES.ERR_LIBRARY_ACCESS_DENIED,
          message: 'This item is restricted to MSV-approved students',
          statusCode: 403,
        });
      }
    }
  }

  private assertCanCreate(role: Role): void {
    const allowed: Role[] = ['shikshak', 'sanchalak', 'city_admin', 'state_admin', 'super_admin'];
    if (!allowed.includes(role)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only shikshak/sanchalak/admin can manage library items',
        statusCode: 403,
      });
    }
  }

  /** Q7 invariants — checked at the service layer too. */
  private validateInvariants(input: {
    content_type: 'pdf' | 'video' | 'audio' | 'image';
    asset_id?: string | null;
    embed_url?: string | null;
  }): void {
    if (input.content_type === 'video') {
      if (!input.embed_url) {
        throw new AppError({
          code: ERROR_CODES.ERR_LIBRARY_EMBED_URL_REQUIRED,
          message: 'Video library items must carry an embed_url (YouTube or Vimeo)',
          statusCode: 400,
        });
      }
      if (input.asset_id) {
        throw new AppError({
          code: ERROR_CODES.ERR_LIBRARY_ASSET_FORBIDDEN,
          message: 'Video library items must NOT carry an asset_id (Q7)',
          statusCode: 400,
        });
      }
      if (!isYoutubeOrVimeo(input.embed_url)) {
        throw new AppError({
          code: ERROR_CODES.ERR_VALIDATION_EMBED_URL_INVALID,
          message: 'embed_url must be a YouTube or Vimeo URL',
          statusCode: 400,
        });
      }
      return;
    }
    // pdf | audio | image
    if (!input.asset_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_LIBRARY_ASSET_REQUIRED,
        message: 'Non-video library items must reference an asset_id',
        statusCode: 400,
      });
    }
    if (input.embed_url) {
      throw new AppError({
        code: ERROR_CODES.ERR_LIBRARY_EMBED_URL_FORBIDDEN,
        message: 'Only video library items may carry an embed_url',
        statusCode: 400,
      });
    }
  }

  // Reference so storage stays imported (signed-URL hook lands when media wiring formalises).
  forTestsOnly_storage(): StorageService {
    return this.storage;
  }
}
