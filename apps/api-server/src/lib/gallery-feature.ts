/**
 * Gallery featuring service — city_admin+ only, scoped by denormalised city_id.
 * Kept out of the route so bulk and single share the same Q2-style service gate.
 */
import { db, gallery_items, cities, type User } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { canFeatureMedia } from "@workspace/api-zod";
import { resolveAdminScope } from "./scope";

export type FeatureFlags = {
  featured_home?: boolean;
  featured_gallery?: boolean;
};

export type FeatureItemResult = "applied" | "forbidden" | "not_found";

/**
 * Whether this actor may feature an item with the given city_id.
 * city_id NULL (admin-uploaded, no student) → super_admin / state_admin only.
 * Enforced here (service), not only at the route guard.
 */
export async function actorMayFeatureCity(
  actor: User,
  itemCityId: string | null,
): Promise<boolean> {
  if (!canFeatureMedia(actor.role)) return false;

  if (itemCityId === null) {
    return actor.role === "super_admin" || actor.role === "state_admin";
  }

  if (actor.role === "super_admin") return true;

  if (actor.role === "city_admin") {
    return !!actor.city_id && actor.city_id === itemCityId;
  }

  if (actor.role === "state_admin") {
    if (!actor.state_id) return false;
    const [row] = await db
      .select({ id: cities.id })
      .from(cities)
      .where(and(eq(cities.id, itemCityId), eq(cities.state_id, actor.state_id)))
      .limit(1);
    return !!row;
  }

  return false;
}

export async function applyGalleryFeatureFlags(
  actor: User,
  id: string,
  flags: FeatureFlags,
): Promise<{ result: FeatureItemResult; row?: {
  id: string;
  featured_home: boolean;
  featured_gallery: boolean;
  featured_at: Date | null;
  featured_by: string | null;
}; old?: { featured_home: boolean; featured_gallery: boolean } }> {
  if (!canFeatureMedia(actor.role)) {
    return { result: "forbidden" };
  }

  const [item] = await db
    .select({
      id: gallery_items.id,
      city_id: gallery_items.city_id,
      featured_home: gallery_items.featured_home,
      featured_gallery: gallery_items.featured_gallery,
    })
    .from(gallery_items)
    .where(and(eq(gallery_items.id, id), isNull(gallery_items.deleted_at)))
    .limit(1);

  if (!item) return { result: "not_found" };

  if (!(await actorMayFeatureCity(actor, item.city_id))) {
    return { result: "forbidden" };
  }

  // Touch resolveAdminScope so city_admin scope stays the source of truth for
  // centre membership (city_id check above is the denormalised fast path).
  await resolveAdminScope(actor);

  const nextHome = flags.featured_home ?? item.featured_home;
  const nextWall = flags.featured_gallery ?? item.featured_gallery;
  const set: Record<string, unknown> = {
    updated_at: new Date(),
    featured_home: nextHome,
    featured_gallery: nextWall,
  };

  if (nextHome || nextWall) {
    set.featured_at = new Date();
    set.featured_by = actor.id;
  } else {
    set.featured_at = null;
    set.featured_by = null;
  }

  const [row] = await db
    .update(gallery_items)
    .set(set)
    .where(and(eq(gallery_items.id, id), isNull(gallery_items.deleted_at)))
    .returning({
      id: gallery_items.id,
      featured_home: gallery_items.featured_home,
      featured_gallery: gallery_items.featured_gallery,
      featured_at: gallery_items.featured_at,
      featured_by: gallery_items.featured_by,
    });

  if (!row) return { result: "not_found" };

  return {
    result: "applied",
    row,
    old: { featured_home: item.featured_home, featured_gallery: item.featured_gallery },
  };
}
