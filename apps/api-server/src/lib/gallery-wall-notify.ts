/**
 * Notify the owning parent when a child's niyam photo lands on the Punya Wall
 * (featured_gallery false → true). Never for featured_home alone; never on re-feature.
 */
import { db, gallery_items, students } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { notifyUsers } from "./notify";
import { enqueueJob } from "./queues";
import { QUEUE_NAMES } from "@jp/shared/constants";
import { logger } from "./logger";

export function isGalleryWallFeatureTransition(
  oldFlags: { featured_gallery: boolean } | undefined,
  newFlags: { featured_gallery: boolean } | undefined,
): boolean {
  return !!oldFlags && !!newFlags && !oldFlags.featured_gallery && newFlags.featured_gallery;
}

/** Resolve parent user ids for student-tied gallery items and notify (prefs-gated). */
export async function notifyParentsOfGalleryWallFeature(
  galleryItemIds: string[],
): Promise<void> {
  const ids = [...new Set(galleryItemIds)].filter(Boolean);
  if (ids.length === 0) return;

  try {
    const rows = await db
      .select({
        galleryId: gallery_items.id,
        parentId: students.parent_id,
        firstName: students.full_name,
      })
      .from(gallery_items)
      .innerJoin(students, eq(students.id, gallery_items.student_id))
      .where(
        and(
          inArray(gallery_items.id, ids),
          isNull(gallery_items.deleted_at),
        ),
      );

    // One notification per parent (dedupe if multiple kids featured in same batch).
    const byParent = new Map<string, { fullName: string; galleryItemId: string }>();
    for (const row of rows) {
      if (!row.parentId) continue;
      if (!byParent.has(row.parentId)) {
        byParent.set(row.parentId, {
          fullName: row.firstName || "your child",
          galleryItemId: row.galleryId,
        });
      }
    }

    for (const [parentId, { fullName, galleryItemId }] of byParent) {
      const shortName = fullName.trim().split(/\s+/)[0] || "your child";
      await notifyUsers({
        userIds: [parentId],
        kind: "gallery",
        title_en: "On the Punya Wall",
        title_hi: "पुण्य दीवार पर",
        body_en: `${shortName}'s niyam photo is now on the Punya Wall.`,
        body_hi: `${shortName} की नियम तस्वीर अब पुण्य दीवार पर है।`,
        data: { kind: "gallery", gallery_item_id: galleryItemId },
      });
    }
  } catch (err) {
    logger.warn({ err, galleryItemIds: ids }, "notifyParentsOfGalleryWallFeature failed");
  }
}

/** Single-item path: notify inline (small volume). */
export async function notifyGalleryWallFeatureInline(galleryItemId: string): Promise<void> {
  await notifyParentsOfGalleryWallFeature([galleryItemId]);
}

/**
 * Bulk path: enqueue so a 100-item feature does not send 100 pushes in the
 * request handler. Without Redis, enqueueJob runs the handler inline.
 */
export async function enqueueGalleryWallFeatureNotifies(
  galleryItemIds: string[],
): Promise<void> {
  const ids = [...new Set(galleryItemIds)].filter(Boolean);
  if (ids.length === 0) return;
  await enqueueJob(QUEUE_NAMES.PARENT_NOTIFY, {
    kind: "gallery_wall_featured",
    gallery_item_ids: ids,
  }).catch((err) => {
    logger.warn({ err, galleryItemIds: ids }, "enqueue gallery wall notify failed");
  });
}
