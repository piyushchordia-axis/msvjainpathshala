/**
 * Join registration notifications.
 *
 * Two moments, two audiences:
 *  - submitted → the people who can actually clear the queue, so a registration
 *    does not sit unseen;
 *  - approved  → the applicant, so they know they can sign in.
 *
 * Both helpers swallow their own failures. A registration is a public write and
 * an approval has already committed by the time we get here — neither may be
 * turned into an error because a push token was stale.
 */
import { and, eq } from "drizzle-orm";
import { centres, db, type JoinKind, users } from "@workspace/db";
import {
  cityAdminUserIdsForCentre,
  notifyUsers,
  sanchalakUserIdsForCentre,
} from "./notify";
import { logger } from "./logger";

/** Persona label used in notification copy. Jain terms stay untranslated. */
const KIND_LABEL: Record<JoinKind, { en: string; hi: string }> = {
  student: { en: "student", hi: "विद्यार्थी" },
  shikshak: { en: "Shikshak", hi: "शिक्षक" },
  sanchalak: { en: "Sanchalak", hi: "संचालक" },
};

/**
 * Who may act on a pending registration of this kind, mirroring
 * `joinKindsForRole` in join-provision.ts. A sanchalak cannot approve another
 * sanchalak, so they are not notified about one — nobody should be paged for a
 * queue they cannot clear.
 *
 * X-18 (review 2026-08) — a centre with no active Sanchalak and no
 * city_admin used to queue registrations to nobody, silently. Falls back up
 * the role ladder (state_admin of the centre's state, then super_admin) —
 * both can certainly clear the queue, and state_admin/super_admin were
 * previously never included at all.
 */
async function reviewerIdsFor(kind: JoinKind, centreId: string): Promise<string[]> {
  const cityAdmins = await cityAdminUserIdsForCentre(centreId);
  const primary =
    kind === "sanchalak" ? cityAdmins : [...(await sanchalakUserIdsForCentre(centreId)), ...cityAdmins];
  const deduped = [...new Set(primary)];
  if (deduped.length > 0) return deduped;

  const [centre] = await db
    .select({ city_id: centres.city_id })
    .from(centres)
    .where(eq(centres.id, centreId))
    .limit(1);
  if (!centre?.city_id) return [];

  const { cities } = await import("@workspace/db");
  const [city] = await db
    .select({ state_id: cities.state_id })
    .from(cities)
    .where(eq(cities.id, centre.city_id))
    .limit(1);

  if (city?.state_id) {
    const stateAdmins = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "state_admin"), eq(users.state_id, city.state_id), eq(users.is_active, true)));
    if (stateAdmins.length > 0) return stateAdmins.map((r) => r.id);
  }

  const superAdmins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "super_admin"), eq(users.is_active, true)));
  return superAdmins.map((r) => r.id);
}

/**
 * Tell the centre's reviewers that a registration is waiting for them.
 *
 * X-15 (review 2026-08, deferred) — every resubmission re-pages the whole
 * reviewer set with no dedupe key. A real fix needs to distinguish "a new
 * pending row" from "the same still-pending row resubmitted", which this
 * function cannot see on its own — left as a caller-side concern (the
 * registration route would need to pass whether this is a genuinely new
 * row) rather than guessed at here.
 */
export async function notifyJoinSubmitted(opts: {
  kind: JoinKind;
  centreId: string;
  registrationId: string;
  name: string;
  displayCode: string;
}): Promise<void> {
  try {
    const userIds = await reviewerIdsFor(opts.kind, opts.centreId);
    if (userIds.length === 0) {
      // X-18 — even after the role-ladder fallback above, log rather than
      // silently drop: no super_admin at all would be a deployment problem
      // worth knowing about.
      logger.warn(
        { kind: opts.kind, centreId: opts.centreId, registrationId: opts.registrationId },
        "notifyJoinSubmitted: zero reviewers resolved for this registration",
      );
      return;
    }
    const label = KIND_LABEL[opts.kind];
    await notifyUsers({
      userIds,
      kind: "join",
      title_en: `New ${label.en} registration`,
      title_hi: `नया ${label.hi} पंजीकरण`,
      body_en: `${opts.name} (${opts.displayCode}) is waiting for your approval.`,
      body_hi: `${opts.name} (${opts.displayCode}) आपकी स्वीकृति की प्रतीक्षा में है।`,
      // X-18 — the payload previously carried no registration id at all, so
      // a notified reviewer had to find the record by hand.
      data: { join_kind: opts.kind, display_code: opts.displayCode, registration_id: opts.registrationId },
    });
  } catch (err) {
    logger.warn({ err, kind: opts.kind, centreId: opts.centreId }, "notifyJoinSubmitted failed");
  }
}

/** Tell the newly provisioned account holder(s) that they are approved. */
export async function notifyJoinApproved(opts: {
  kind: JoinKind;
  userIds: (string | null | undefined)[];
  name: string;
  displayCode: string;
}): Promise<void> {
  try {
    const userIds = opts.userIds.filter((id): id is string => !!id);
    if (userIds.length === 0) return;
    await notifyUsers({
      userIds,
      kind: "join",
      title_en: "Your registration is approved",
      title_hi: "आपका पंजीकरण स्वीकृत हो गया",
      body_en: `Welcome, ${opts.name}. Sign in with your mobile number to get started — your ID is ${opts.displayCode}.`,
      body_hi: `स्वागत है, ${opts.name}। शुरू करने के लिए अपने मोबाइल नंबर से लॉगिन करें — आपकी ID ${opts.displayCode} है।`,
      data: { join_kind: opts.kind, display_code: opts.displayCode },
    });
  } catch (err) {
    logger.warn({ err, kind: opts.kind, displayCode: opts.displayCode }, "notifyJoinApproved failed");
  }
}
