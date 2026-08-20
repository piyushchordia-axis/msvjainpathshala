/**
 * C2 fallout — list every quiz question for human review of its answer key.
 *
 * The admin panel's option editor filtered blank options out of the payload but
 * derived `correct_indices` from the UNFILTERED draft, so a blank option above
 * a ticked one shifted the stored answer key downward. Ticking option 2 of
 * [blank, Ahimsa, Satya] stored options=[Ahimsa, Satya] with correct_indices=[1]
 * — pointing at Satya.
 *
 * There is NO query that separates a corrupted key from a correct one: the blank
 * was dropped client-side, so the stored row is well-formed either way. The only
 * remedy is a human reading each question against its marked answer. This script
 * produces that worklist as CSV, ordered by blast radius:
 *
 *   1. attached to an event that already has SUBMITTED attempts (children were
 *      graded against this key — fix first, then reset the affected attempts);
 *   2. attached to an event with attempts in progress or none yet;
 *   3. unattached bank rows.
 *
 * Only `source = 'manual'` rows can be affected — nothing else goes through that
 * editor — but the filter is a flag so the full bank can be swept if wanted.
 *
 * Usage:
 *   node lib/db/scripts/audit-quiz-answer-keys.mjs > quiz-answer-keys.csv
 *   node lib/db/scripts/audit-quiz-answer-keys.mjs --all > all.csv
 *
 * Reads DATABASE_URL. Read-only — it writes nothing.
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
const allSources = process.argv.includes("--all");

/** RFC-4180 quoting: double the quotes, wrap anything with a comma/quote/newline. */
function csv(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

const SQL = `
  with usage as (
    select
      eq.question_id,
      count(distinct eq.quiz_event_id)::int as event_count,
      count(distinct a.id) filter (where a.submitted_at is not null)::int as submitted_attempts,
      count(distinct a.id)::int as total_attempts
    from quiz_event_questions eq
    left join quiz_attempts a on a.quiz_event_id = eq.quiz_event_id
    group by eq.question_id
  )
  select
    q.id,
    q.scope,
    q.topic,
    q.source,
    q.is_active,
    q.created_at,
    q.question_en,
    q.options,
    q.correct_indices,
    coalesce(u.event_count, 0)        as event_count,
    coalesce(u.submitted_attempts, 0) as submitted_attempts,
    coalesce(u.total_attempts, 0)     as total_attempts
  from questions q
  left join usage u on u.question_id = q.id
  ${allSources ? "" : "where q.source = 'manual'"}
  order by
    coalesce(u.submitted_attempts, 0) desc,
    coalesce(u.total_attempts, 0) desc,
    q.created_at desc
`;

const pool = new pg.Pool({ connectionString: url });
try {
  const { rows } = await pool.query(SQL);

  const header = [
    "question_id",
    "scope",
    "topic",
    "source",
    "is_active",
    "created_at",
    "risk",
    "events",
    "submitted_attempts",
    "total_attempts",
    "question_en",
    "options_in_order",
    "correct_indices",
    "marked_answers",
  ];
  console.log(header.join(","));

  for (const r of rows) {
    const options = Array.isArray(r.options) ? r.options : [];
    const texts = options.map((o) => (o && typeof o === "object" ? (o.text_en ?? "") : String(o)));
    const indices = Array.isArray(r.correct_indices) ? r.correct_indices : [];
    // What a child is currently graded against — this is the column to read.
    const marked = indices.map((i) => texts[i] ?? `<index ${i} out of range>`);

    const risk =
      r.submitted_attempts > 0 ? "1-graded" : r.total_attempts > 0 ? "2-in-progress" : r.event_count > 0 ? "3-attached" : "4-bank-only";

    console.log(
      [
        r.id,
        r.scope,
        r.topic,
        r.source,
        r.is_active,
        r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
        risk,
        r.event_count,
        r.submitted_attempts,
        r.total_attempts,
        r.question_en,
        texts.map((t, i) => `${i}. ${t}`).join(" | "),
        indices.join(" "),
        marked.join(" | "),
      ]
        .map(csv)
        .join(","),
    );
  }

  const graded = rows.filter((r) => r.submitted_attempts > 0).length;
  console.error(
    `${rows.length} question(s) listed; ${graded} already graded children and need review first.`,
  );
} finally {
  await pool.end();
}
