/**
 * H10 — quizzes tell people they exist.
 *
 * The module shipped with ZERO notifications: `quizzes.ts` never imported
 * `notify`, so a live push quiz was only discoverable by a 20-second poll that
 * runs *while the student already sits on the quizzes screen*, and a scheduled
 * event opening was announced to nobody at all. The mobile screen's docblock
 * even claimed "a notification tap deep-links here too" — a path that did not
 * exist.
 *
 * Both entry points are best-effort: a notification failure must never fail the
 * authoring request that triggered it. A Guruji whose push quiz reported
 * "failed" because a push token was stale would simply create a second one.
 */
import { db, quiz_events, push_quizzes } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { notifyUsers } from "./notify";
import { logger } from "./logger";

/**
 * Targets as stored on a quiz row, with the legacy single FKs folded in.
 * Mirrors quiz-scope.ts's QuizScopeTargets, but as VALUES rather than columns.
 */
type QuizTargets = {
  scope: string;
  state_ids: string[];
  city_ids: string[];
  centre_ids: string[];
  batch_ids: string[];
  age_groups: string[];
};

function normalize(row: {
  scope: string;
  state_ids?: string[] | null;
  city_ids?: string[] | null;
  centre_ids?: string[] | null;
  batch_ids?: string[] | null;
  city_id?: string | null;
  centre_id?: string | null;
  batch_id?: string | null;
  age_groups?: string[] | null;
}): QuizTargets {
  return {
    scope: row.scope,
    state_ids: row.state_ids?.length ? row.state_ids : [],
    city_ids: row.city_ids?.length ? row.city_ids : row.city_id ? [row.city_id] : [],
    centre_ids: row.centre_ids?.length ? row.centre_ids : row.centre_id ? [row.centre_id] : [],
    batch_ids: row.batch_ids?.length ? row.batch_ids : row.batch_id ? [row.batch_id] : [],
    age_groups: row.age_groups?.length ? row.age_groups : [],
  };
}

function uuidArray(ids: string[]) {
  return ids.length === 0
    ? sql`ARRAY[]::uuid[]`
    : sql`ARRAY[${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}]::uuid[]`;
}

/**
 * Recipient user ids for a quiz: the parent of every active targeted student,
 * plus any student holding their own login (Q4 — age 8+ with a distinct mobile).
 *
 * This is the INVERSE of `quizMatchesStudentSql`: that one takes quiz COLUMNS
 * and a single student's values (it filters quizzes for one child); here we have
 * one quiz's values and need to filter students. The scope arms below are
 * deliberately the same shape and order as `quizMatchesStudent` so the two read
 * as the same rule — if that rule changes, both must change together.
 *
 * Done in SQL rather than by loading every active student and filtering in JS:
 * a national quiz would otherwise pull the entire roster into memory.
 */
async function recipientUserIds(targets: QuizTargets): Promise<string[]> {
  const t = targets;
  const scopeMatch = sql`(
    ${t.scope} = 'national'
    OR (${t.scope} = 'state'  AND c.state_id IS NOT NULL AND c.state_id = ANY(${uuidArray(t.state_ids)}))
    OR (${t.scope} = 'city'   AND c.city_id  IS NOT NULL AND c.city_id  = ANY(${uuidArray(t.city_ids)}))
    OR (${t.scope} = 'centre' AND s.centre_id IS NOT NULL AND s.centre_id = ANY(${uuidArray(t.centre_ids)}))
    OR (${t.scope} = 'batch'  AND s.batch_id  IS NOT NULL AND s.batch_id  = ANY(${uuidArray(t.batch_ids)}))
  )`;

  // Empty age_groups = every age group (matches quizMatchesStudent).
  const ageMatch =
    t.age_groups.length === 0
      ? sql`true`
      : sql`(s.age_group IS NOT NULL AND s.age_group::text = ANY(ARRAY[${sql.join(
          t.age_groups.map((g) => sql`${g}::text`),
          sql`, `,
        )}]))`;

  const result = await db.execute(sql`
    select distinct u.id
    from students s
    left join centres c on c.id = s.centre_id
    join users u
      on u.id = s.parent_id
      or u.id = s.user_id
    where s.status = 'active'
      and s.deleted_at is null
      and u.is_active = true
      and ${scopeMatch}
      and ${ageMatch}
  `);
  const rows = (result as unknown as { rows?: Array<{ id: string }> }).rows ?? [];
  return rows.map((r) => r.id);
}

/** A live push quiz has started for this student's batch/centre. */
export async function notifyPushQuizStarted(pushQuizId: string): Promise<void> {
  try {
    const [row] = await db
      .select()
      .from(push_quizzes)
      .where(eq(push_quizzes.id, pushQuizId))
      .limit(1);
    if (!row) return;
    const userIds = await recipientUserIds(normalize(row));
    if (userIds.length === 0) return;
    await notifyUsers({
      userIds,
      kind: "quiz",
      title_en: "A class quiz has started",
      title_hi: "कक्षा प्रश्नोत्तरी शुरू हो गई है",
      body_en: "Your Guruji has started a live quiz. Open Quizzes to join before it closes.",
      body_hi: "गुरुजी ने लाइव प्रश्नोत्तरी शुरू की है। बंद होने से पहले प्रश्नोत्तरी खोलकर भाग लें।",
      data: { push_quiz_id: pushQuizId, route: "/quizzes" },
    });
  } catch (err) {
    // Best-effort: the quiz exists either way, and a Guruji mid-class must not
    // be told it failed to start because a push token was stale.
    logger.warn({ err, pushQuizId }, "notifyPushQuizStarted failed");
  }
}

/** A scheduled quiz event is open for taking right now. */
export async function notifyQuizEventOpen(quizEventId: string): Promise<void> {
  try {
    const [row] = await db
      .select()
      .from(quiz_events)
      .where(eq(quiz_events.id, quizEventId))
      .limit(1);
    if (!row) return;
    const userIds = await recipientUserIds(normalize(row));
    if (userIds.length === 0) return;
    await notifyUsers({
      userIds,
      kind: "quiz",
      title_en: "A new quiz is open",
      title_hi: "नई प्रश्नोत्तरी उपलब्ध है",
      body_en: `${row.title_en} is open now — take it before the window closes.`,
      body_hi: `${row.title_hi ?? row.title_en} अभी खुली है — समय समाप्त होने से पहले भाग लें।`,
      data: { quiz_event_id: quizEventId, route: "/quizzes" },
    });
  } catch (err) {
    logger.warn({ err, quizEventId }, "notifyQuizEventOpen failed");
  }
}

/** Exported for tests: how many accounts a quiz would reach. */
export async function quizAudienceSize(
  kind: "event" | "push",
  quizId: string,
): Promise<number> {
  const table = kind === "event" ? quiz_events : push_quizzes;
  const [row] = await db.select().from(table).where(eq(table.id, quizId)).limit(1);
  if (!row) return 0;
  return (await recipientUserIds(normalize(row))).length;
}
