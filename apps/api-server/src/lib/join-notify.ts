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
import type { JoinKind } from "@workspace/db";
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
 */
async function reviewerIdsFor(kind: JoinKind, centreId: string): Promise<string[]> {
  const cityAdmins = await cityAdminUserIdsForCentre(centreId);
  if (kind === "sanchalak") return cityAdmins;
  const sanchalaks = await sanchalakUserIdsForCentre(centreId);
  return [...sanchalaks, ...cityAdmins];
}

/** Tell the centre's reviewers that a registration is waiting for them. */
export async function notifyJoinSubmitted(opts: {
  kind: JoinKind;
  centreId: string;
  name: string;
  displayCode: string;
}): Promise<void> {
  try {
    const userIds = await reviewerIdsFor(opts.kind, opts.centreId);
    if (userIds.length === 0) return;
    const label = KIND_LABEL[opts.kind];
    await notifyUsers({
      userIds,
      kind: "join",
      title_en: `New ${label.en} registration`,
      title_hi: `नया ${label.hi} पंजीकरण`,
      body_en: `${opts.name} (${opts.displayCode}) is waiting for your approval.`,
      body_hi: `${opts.name} (${opts.displayCode}) आपकी स्वीकृति की प्रतीक्षा में है।`,
      data: { join_kind: opts.kind, display_code: opts.displayCode },
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
