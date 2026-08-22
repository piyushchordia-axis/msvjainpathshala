/**
 * Library content-request review — Section 17 v3 §17.10.4–§17.10.5.
 *
 * AUTHORITY LIVES HERE, not in a route guard. The queue is readable by
 * city_admin and above, but only state_admin and super_admin may accept,
 * reject, or spawn an item — and a city_admin calling the endpoint directly
 * must get a 403, exactly as Q2 requires of MSV curricula. A middleware on the
 * router could not express that split without either over-gating the read or
 * leaving the writes open, so both checks are functions the handlers call.
 *
 * No new roles (Q12) — this is the existing eight-role ladder, read through
 * the shared rank helper.
 */
import { and, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Role } from "@workspace/api-zod";
import {
  db,
  library_content_requests,
  library_items,
  library_sections,
  users,
  type LibraryContentRequest,
} from "@workspace/db";
import { hasMinRole } from "./roles";
import { notifyUsers } from "./notify";
import { logger } from "./logger";

export type RequestStatus = "pending" | "accepted" | "rejected" | "published";

/** §17.10.5 — city_admin and above may READ the queue. */
export function canReadRequestQueue(role: Role | string | null | undefined): boolean {
  return hasMinRole(role, "city_admin");
}

/** §17.10.5 — only state_admin and super_admin may ACT on a request. */
export function canActOnRequests(role: Role | string | null | undefined): boolean {
  return hasMinRole(role, "state_admin");
}

/** Thrown by the service when a caller may read but not act. */
export class LibraryRequestForbiddenError extends Error {
  readonly code = "ERR_LIBRARY_REQUEST_ACTION_FORBIDDEN";
  constructor() {
    super("Only a state or national admin can act on content requests.");
    this.name = "LibraryRequestForbiddenError";
  }
}

/** Thrown when the requested transition is not one the lifecycle allows. */
export class LibraryRequestTransitionError extends Error {
  constructor(
    readonly from: RequestStatus,
    readonly to: RequestStatus,
    message: string,
  ) {
    super(message);
    this.name = "LibraryRequestTransitionError";
  }
}

export function assertCanAct(role: Role | string | null | undefined): void {
  if (!canActOnRequests(role)) throw new LibraryRequestForbiddenError();
}

/**
 * §17.10.4 lifecycle.
 *
 *   pending ──→ accepted ──→ published   (published is SYSTEM-SET only)
 *      │            │
 *      └──→ rejected ←┘
 *
 * `rejected` and `published` are terminal. `accepted → rejected` is allowed
 * because plans change and an admin must be able to say so; the requester may
 * always submit afresh.
 */
const ADMIN_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  pending: ["accepted", "rejected"],
  accepted: ["rejected"],
  rejected: [],
  published: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return (ADMIN_TRANSITIONS[from] ?? []).includes(to);
}

export interface RequestQueueFilters {
  status?: RequestStatus | null;
  sectionId?: string | null;
  from?: string | null;
  to?: string | null;
  limit: number;
  offset: number;
}

/** Queue rows + a total so the admin sees how much work there is, not just a page. */
export async function listRequestQueue(f: RequestQueueFilters): Promise<{
  rows: Array<Record<string, unknown>>;
  total: number;
}> {
  const conds = [];
  if (f.status) conds.push(eq(library_content_requests.status, f.status));
  if (f.sectionId) conds.push(eq(library_content_requests.section_id, f.sectionId));
  // Dates arrive as YYYY-MM-DD; `to` is inclusive of the whole day, which is
  // what an admin picking "1 Aug – 7 Aug" means.
  if (f.from) conds.push(gte(library_content_requests.created_at, new Date(`${f.from}T00:00:00.000Z`)));
  if (f.to) conds.push(lte(library_content_requests.created_at, new Date(`${f.to}T23:59:59.999Z`)));
  const where = conds.length > 0 ? and(...conds) : undefined;

  const rows = await db
    .select({
      id: library_content_requests.id,
      section_id: library_content_requests.section_id,
      section_name_en: library_sections.name_en,
      section_name_hi: library_sections.name_hi,
      suggested_section: library_content_requests.suggested_section,
      title: library_content_requests.title,
      details: library_content_requests.details,
      reference_url: library_content_requests.reference_url,
      requester_user_id: library_content_requests.requester_user_id,
      requester_device_id: library_content_requests.requester_device_id,
      requester_name: library_content_requests.requester_name,
      requester_phone: library_content_requests.requester_phone,
      status: library_content_requests.status,
      admin_note: library_content_requests.admin_note,
      linked_item_id: library_content_requests.linked_item_id,
      actioned_by: library_content_requests.actioned_by,
      actioned_at: library_content_requests.actioned_at,
      created_at: library_content_requests.created_at,
    })
    .from(library_content_requests)
    .leftJoin(library_sections, eq(library_sections.id, library_content_requests.section_id))
    .where(where)
    .orderBy(desc(library_content_requests.created_at))
    .limit(f.limit)
    .offset(f.offset);

  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(library_content_requests)
    .where(where);

  return { rows, total: count?.n ?? 0 };
}

export async function getRequest(id: string): Promise<LibraryContentRequest | null> {
  const [row] = await db
    .select()
    .from(library_content_requests)
    .where(eq(library_content_requests.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * §17.10.5 — other PENDING requests asking for the same thing.
 *
 * Five people asking for one stavan is one piece of work, and an admin who
 * cannot see that will source it once and reject four duplicates as if they
 * were separate refusals. Matched on title words rather than exact equality:
 * nobody types the same title twice.
 */
export async function similarPendingRequests(
  request: Pick<LibraryContentRequest, "id" | "title">,
  limit = 10,
): Promise<Array<{ id: string; title: string; requester_name: string; created_at: Date }>> {
  // Longest few words carry the signal; "the", "of", "please" match everything.
  const terms = request.title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
  if (terms.length === 0) return [];

  /**
   * Score by how many terms hit, and require TWO when the title gave us two to
   * work with. A single shared word is not a duplicate — "Panchang for next
   * year" and "Bhaktamar Stotra recording" both contain "please" or any other
   * incidental four-letter token, and a list padded with those is worse than no
   * list at all: the admin stops reading it, and the five people who really did
   * ask for the same stavan go back to looking like five separate jobs.
   */
  const score = sql<number>`(${sql.join(
    terms.map((w) => sql`(${library_content_requests.title} ILIKE ${`%${w}%`})::int`),
    sql` + `,
  )})`;
  const required = terms.length >= 2 ? 2 : 1;

  return db
    .select({
      id: library_content_requests.id,
      title: library_content_requests.title,
      requester_name: library_content_requests.requester_name,
      created_at: library_content_requests.created_at,
    })
    .from(library_content_requests)
    .where(
      and(
        eq(library_content_requests.status, "pending"),
        ne(library_content_requests.id, request.id),
        sql`${score} >= ${required}`,
      ),
    )
    .orderBy(desc(score), desc(library_content_requests.created_at))
    .limit(limit);
}

/**
 * Accept or reject. Returns the updated row.
 *
 * The status guard is inside the UPDATE's WHERE as well as checked up front:
 * two admins opening the same queue and both pressing Accept would otherwise
 * both succeed, and the second would overwrite the first's actioned_by.
 */
export async function decideRequest(opts: {
  id: string;
  to: "accepted" | "rejected";
  adminNote?: string | null;
  actorId: string;
  actorRole: Role | string | null | undefined;
}): Promise<LibraryContentRequest | null> {
  assertCanAct(opts.actorRole);

  const current = await getRequest(opts.id);
  if (!current) return null;
  const from = current.status as RequestStatus;
  if (!canTransition(from, opts.to)) {
    throw new LibraryRequestTransitionError(
      from,
      opts.to,
      from === opts.to
        ? `This request is already ${from}.`
        : `A ${from} request cannot be marked ${opts.to}.`,
    );
  }

  const [updated] = await db
    .update(library_content_requests)
    .set({
      status: opts.to,
      // Only overwrite the note when one was supplied — clearing an earlier
      // note by omitting the field would silently lose what the requester was told.
      ...(opts.adminNote !== undefined ? { admin_note: opts.adminNote } : {}),
      actioned_by: opts.actorId,
      actioned_at: new Date(),
      updated_at: new Date(),
    })
    .where(and(eq(library_content_requests.id, opts.id), eq(library_content_requests.status, from)))
    .returning();

  if (!updated) {
    // Someone else moved it between our read and our write.
    throw new LibraryRequestTransitionError(
      from,
      opts.to,
      "Someone else just actioned this request — reload the queue to see where it stands.",
    );
  }

  // X-17 (review 2026-08) — a rejected request never reached the requester
  // at all, despite admin_note existing specifically to tell them something.
  // Account holders only (§17.10.7, same scope cut as the publish path);
  // best-effort — a notify failure must not undo the decision that already
  // committed above.
  if (opts.to === "rejected" && updated.requester_user_id) {
    const note = updated.admin_note?.trim();
    await notifyUsers({
      userIds: [updated.requester_user_id],
      kind: "library",
      title_en: "Update on your library request",
      title_hi: "आपके पुस्तकालय अनुरोध पर अपडेट",
      body_en: note
        ? `"${updated.title}" was not added this time — ${note}`
        : `"${updated.title}" was not added this time.`,
      body_hi: note
        ? `“${updated.title}” इस बार नहीं जोड़ा गया — ${note}`
        : `“${updated.title}” इस बार नहीं जोड़ा गया।`,
      data: { kind: "library", request_id: updated.id },
    }).catch((err) => {
      logger.warn({ err, request_id: updated.id }, "library request rejection notify failed");
    });
  }

  return updated;
}

/**
 * §17.10.5 — spawn a draft library item prefilled from the request, and record
 * `linked_item_id` so publishing that item later flips the request to published.
 *
 * The item is a DRAFT: the normal draft/publish flow takes over from here, and
 * only a super_admin can publish it. Creating one does not decide the request —
 * an accepted request is still accepted until the item goes live.
 */
export async function createItemFromRequest(opts: {
  id: string;
  actorId: string;
  actorRole: Role | string | null | undefined;
}): Promise<{ request: LibraryContentRequest; itemId: string; itemCode: string } | null> {
  assertCanAct(opts.actorRole);

  const current = await getRequest(opts.id);
  if (!current) return null;
  if (current.status === "rejected" || current.status === "published") {
    throw new LibraryRequestTransitionError(
      current.status as RequestStatus,
      "accepted",
      `A ${current.status} request is closed — a fresh request is needed before sourcing this.`,
    );
  }
  if (current.linked_item_id) {
    throw new LibraryRequestTransitionError(
      current.status as RequestStatus,
      "accepted",
      "A draft item was already created for this request — open it from the request instead.",
    );
  }
  if (!current.section_id) {
    // "Other" requests name a section in free text. An admin has to decide
    // where it actually belongs before an item can exist, and guessing here
    // would file content under whatever the requester typed.
    throw new LibraryRequestTransitionError(
      current.status as RequestStatus,
      "accepted",
      "This request suggests a new section — pick a real section on the item before creating it.",
    );
  }

  const sectionId = current.section_id;
  const itemCode = await uniqueItemCode(current.title);

  const created = await db.transaction(async (tx) => {
    const [orderRow] = await tx
      .select({
        draft: sql<number>`coalesce(max(${library_items.draft_order_index}), -1) + 1`,
        published: sql<number>`coalesce(max(${library_items.order_index}), -1) + 1`,
      })
      .from(library_items)
      .where(
        and(
          eq(library_items.section_id, sectionId),
          isNull(library_items.subsection_id),
          isNull(library_items.deleted_at),
        ),
      );

    const [item] = await tx
      .insert(library_items)
      .values({
        section_id: sectionId,
        item_code: itemCode,
        title_en: current.title,
        order_index: orderRow?.published ?? 0,
        draft_title_en: current.title,
        draft_order_index: orderRow?.draft ?? 0,
        is_published: false,
        content_version: 1,
      })
      .returning({ id: library_items.id });

    const [request] = await tx
      .update(library_content_requests)
      .set({ linked_item_id: item!.id, updated_at: new Date() })
      .where(eq(library_content_requests.id, opts.id))
      .returning();

    return { request: request!, itemId: item!.id, itemCode };
  });

  return created;
}

/** `item_code` is globally unique; derive a readable one and disambiguate. */
async function uniqueItemCode(title: string): Promise<string> {
  const base =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "request";
  const existing = await db
    .select({ code: library_items.item_code })
    .from(library_items)
    .where(ilike(library_items.item_code, `${base}%`));
  const taken = new Set(existing.map((r) => r.code));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 500; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * §17.10.4 / §17.10.7 — SYSTEM-SET publish.
 *
 * Called from the library publish path when an item goes live: any accepted
 * request pointing at that item flips to `published` and its requester is told.
 * There is deliberately no admin route that sets `published` directly — the
 * status means "the thing you asked for is in the library", and only publishing
 * the item makes that true.
 *
 * Never throws. Publishing an item must not fail because a notification could
 * not be delivered; the request rows are already updated by then.
 */
export async function publishLinkedContentRequests(itemId: string): Promise<number> {
  let newlyPublished = 0;
  try {
    const updated = await db
      .update(library_content_requests)
      .set({ status: "published", updated_at: new Date() })
      .where(
        and(
          eq(library_content_requests.linked_item_id, itemId),
          eq(library_content_requests.status, "accepted"),
        ),
      )
      .returning({ id: library_content_requests.id });
    newlyPublished = updated.length;
  } catch (err) {
    logger.error({ err, item_id: itemId }, "[library-requests] publish transition failed");
    return 0;
  }

  // X-17 (review 2026-08) — re-select EVERY published-but-unnotified row for
  // this item, not just the ones this call just transitioned. A prior call
  // that flipped the status but threw before notifying everyone left rows
  // permanently unreachable by the old WHERE (status = 'accepted'); notified_at
  // is what lets a retry find and finish them.
  const pending = await db
    .select({
      id: library_content_requests.id,
      title: library_content_requests.title,
      requester_user_id: library_content_requests.requester_user_id,
    })
    .from(library_content_requests)
    .where(
      and(
        eq(library_content_requests.linked_item_id, itemId),
        eq(library_content_requests.status, "published"),
        isNull(library_content_requests.notified_at),
      ),
    );

  if (pending.length === 0) return newlyPublished;

  // §17.10.7 — account holders only. A pure guest who never signed in has no
  // inbox to write to; their number permits manual outreach and nothing more.
  // This is a deliberate scope cut, not an oversight. A guest row has no
  // notification to send, so it is marked notified immediately.
  let notified = 0;
  for (const row of pending) {
    if (!row.requester_user_id) {
      await db
        .update(library_content_requests)
        .set({ notified_at: new Date() })
        .where(eq(library_content_requests.id, row.id));
      continue;
    }
    // X-10 shape — per-row try/catch so one requester's push failure does
    // not strand every other requester's notification behind it.
    try {
      await notifyUsers({
        userIds: [row.requester_user_id],
        kind: "library",
        title_en: "Your request is in the library",
        title_hi: "आपका अनुरोध पुस्तकालय में आ गया",
        body_en: `"${row.title}" has been added — open it in the library.`,
        body_hi: `“${row.title}” जोड़ दिया गया है — पुस्तकालय में खोलें।`,
        data: { kind: "library", library_item_id: itemId, request_id: row.id },
      });
      await db
        .update(library_content_requests)
        .set({ notified_at: new Date() })
        .where(eq(library_content_requests.id, row.id));
      notified += 1;
    } catch (err) {
      logger.error({ err, item_id: itemId, request_id: row.id }, "[library-requests] notify failed for one requester");
    }
  }

  logger.info(
    { item_id: itemId, newly_published: newlyPublished, notified, pending: pending.length },
    "[library-requests] linked requests published",
  );
  return newlyPublished;
}

/** Requester display names for the queue, resolved in one round trip. */
export async function requesterAccountNames(
  userIds: Array<string | null>,
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((v): v is string => !!v))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, full_name: users.full_name })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.full_name]));
}
