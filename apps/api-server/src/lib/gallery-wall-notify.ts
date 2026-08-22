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

/** Bilingual "A, B and C" / "A, B और C" join for merged-children copy (X-22). */
function joinNames(names: string[], andWord: "and" | "और"): string {
  if (names.length <= 1) return names[0] ?? "your child";
  if (names.length === 2) return `${names[0]} ${andWord} ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} ${andWord} ${names[names.length - 1]}`;
}

/** Resolve parent user ids for student-tied gallery items and notify (prefs-gated). */
export async function notifyParentsOfGalleryWallFeature(
  galleryItemIds: string[],
): Promise<void> {
  const ids = [...new Set(galleryItemIds)].filter(Boolean);
  if (ids.length === 0) return;

  let rows: { galleryId: string; parentId: string | null; firstName: string }[];
  try {
    rows = await db
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
  } catch (err) {
    logger.warn({ err, galleryItemIds: ids }, "notifyParentsOfGalleryWallFeature lookup failed");
    return;
  }

  // One notification per parent, naming EVERY featured child of theirs in
  // this batch — X-22 (review 2026-08): keeping only the first child per
  // parent correctly deduped the NOTIFICATION but silently dropped the
  // second child's name from the copy, so the parent never learned Diya was
  // featured too.
  const byParent = new Map<string, { names: string[]; galleryItemIds: string[] }>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const entry = byParent.get(row.parentId) ?? { names: [], galleryItemIds: [] };
    const name = (row.firstName || "your child").trim().split(/\s+/)[0] || "your child";
    if (!entry.names.includes(name)) entry.names.push(name);
    entry.galleryItemIds.push(row.galleryId);
    byParent.set(row.parentId, entry);
  }

  // X-23 — batch identical copy into one notifyUsers call instead of one
  // call per parent (each was 3 queries + 1 Expo HTTP round trip, serially).
  // Parents whose merged name string happens to match (most often a single
  // shared child) genuinely share one call; the rest fall out to their own.
  const byBody = new Map<
    string,
    { body_en: string; body_hi: string; userIds: string[]; galleryItemId: string }
  >();
  for (const [parentId, { names, galleryItemIds }] of byParent) {
    const body_en = `${joinNames(names, "and")}'s niyam photo is now on the Punya Wall.`;
    const body_hi = `${joinNames(names, "और")} की नियम तस्वीर अब पुण्य दीवार पर है।`;
    const entry = byBody.get(body_en) ?? {
      body_en,
      body_hi,
      userIds: [],
      galleryItemId: galleryItemIds[0]!,
    };
    entry.userIds.push(parentId);
    byBody.set(body_en, entry);
  }

  // X-10 shape — per-group try/catch so one group's failure doesn't abort
  // the rest of the batch (the old code wrapped the whole per-parent loop
  // in a single try).
  for (const { body_en, body_hi, userIds, galleryItemId } of byBody.values()) {
    try {
      await notifyUsers({
        userIds,
        kind: "gallery",
        title_en: "On the Punya Wall",
        title_hi: "पुण्य दीवार पर",
        body_en,
        body_hi,
        data: { kind: "gallery", gallery_item_id: galleryItemId },
      });
    } catch (err) {
      logger.warn({ err, userIds }, "notifyParentsOfGalleryWallFeature failed for one group");
    }
  }
}

/** Single-item path: notify inline (small volume). */
export async function notifyGalleryWallFeatureInline(galleryItemId: string): Promise<void> {
  await notifyParentsOfGalleryWallFeature([galleryItemId]);
}

/**
 * Bulk path: enqueue so a 100-item feature does not send 100 pushes in the
 * request handler. Without Redis, enqueueJob runs the handler inline.
 *
 * X-15 (review 2026-08) — no dedupe key against a genuine BullMQ retry
 * re-sending the same batch. Largely mitigated by the X-10 fix above (every
 * failure inside notifyParentsOfGalleryWallFeature is now caught and logged
 * rather than thrown, so this job effectively never fails and BullMQ never
 * retries it) — but a true idempotency key (e.g. a `wall_notified_at`
 * column, claimed the way shivir-notify claims `announced_at`) would close
 * the gap completely. Left as a schema change for a future pass rather than
 * bolted on here.
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
