/**
 * One-off repair: niyam submissions that were auto-approved but never awarded.
 *
 * Between the mobile client moving onto jp.queue.niyam_submissions and the fix
 * that routed /v1/sync/batch through services/niyam-submit.ts, the offline
 * handler inserted submissions with status='auto_approved', points_awarded=0
 * and no punya_transactions row. Children were shown "approved" and given
 * nothing; streaks and badges did not advance either.
 *
 * This replays the award for those rows using the SAME idempotency key the
 * live path uses (`submission:{id}`), so a row that did somehow get its ledger
 * entry is a no-op — awardPunya's ON CONFLICT DO NOTHING … RETURNING moves the
 * balance only by what it actually inserted (AT20). Streaks and badges are
 * recomputed per (student, niyam) afterwards.
 *
 * Dry run (default) prints what it would do and changes nothing:
 *   pnpm --filter @workspace/api-server exec tsx ./scripts/repair-niyam-zero-awards.ts
 * Apply:
 *   ... ./scripts/repair-niyam-zero-awards.ts --apply
 */
import {
  db,
  pool,
  niyams,
  niyam_submissions,
  niyam_submission_media,
  students,
  centres,
} from "@workspace/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { awardPunya } from "../src/lib/punya";
import { resolveNiyamAwardPoints } from "../src/lib/niyam-points";
import { awardNewlyReachedBadges } from "../src/lib/niyam-badges";
import { maybeInsertGalleryFromSubmission } from "../src/services/niyam-approve";
import { recomputeStreak } from "../src/routes/v1/niyam-submissions";
import type { NiyamPeriodType } from "../src/lib/niyam-period";

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: niyam_submissions.id,
      student_id: niyam_submissions.student_id,
      niyam_id: niyam_submissions.niyam_id,
      submission_date: niyam_submissions.submission_date,
      notes: niyam_submissions.notes,
      submitted_by: niyam_submissions.submitted_by,
      points: niyams.points,
      niyam_type: niyams.niyam_type,
      city_id: centres.city_id,
    })
    .from(niyam_submissions)
    .innerJoin(niyams, eq(niyams.id, niyam_submissions.niyam_id))
    .innerJoin(students, eq(students.id, niyam_submissions.student_id))
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .where(
      and(
        eq(niyam_submissions.status, "auto_approved"),
        eq(niyam_submissions.points_awarded, 0),
        isNull(niyam_submissions.punya_transaction_id),
      ),
    )
    .orderBy(asc(niyam_submissions.created_at));

  console.log(`Under-awarded auto_approved submissions found: ${rows.length}`);
  if (rows.length === 0) {
    console.log("Nothing to repair.");
    return;
  }

  const byStudentNiyam = new Map<string, { studentId: string; niyamId: string; type: string }>();
  let wouldAward = 0;
  for (const r of rows) {
    const points = await resolveNiyamAwardPoints(r.points, r.city_id);
    wouldAward += points;
    byStudentNiyam.set(`${r.student_id}:${r.niyam_id}`, {
      studentId: r.student_id,
      niyamId: r.niyam_id,
      type: r.niyam_type,
    });
  }
  console.log(
    `Distinct (student, niyam) pairs needing a streak recompute: ${byStudentNiyam.size}`,
  );
  console.log(`Total Punya to be awarded: ${wouldAward}`);

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to repair.");
    return;
  }

  let repaired = 0;
  for (const r of rows) {
    const points = await resolveNiyamAwardPoints(r.points, r.city_id);
    await db.transaction(async (tx) => {
      const award = await awardPunya(
        {
          studentId: r.student_id,
          featureKey: "niyam_submission",
          points,
          note: r.notes,
          awardedBy: r.submitted_by,
          idempotencyKey: `submission:${r.id}`,
        },
        tx,
      );
      await tx
        .update(niyam_submissions)
        .set({
          points_awarded: points,
          approved_at: new Date(),
          punya_transaction_id: award.transaction_id,
        })
        .where(eq(niyam_submissions.id, r.id));

      // The gallery insert was skipped too — replay it from the stored media.
      const media = await tx
        .select({
          url: niyam_submission_media.url,
          kind: niyam_submission_media.kind,
          mime: niyam_submission_media.mime,
        })
        .from(niyam_submission_media)
        .where(eq(niyam_submission_media.submission_id, r.id))
        .orderBy(asc(niyam_submission_media.ordinal));
      if (media.length > 0) {
        await maybeInsertGalleryFromSubmission(tx, {
          submissionId: r.id,
          studentId: r.student_id,
          niyamId: r.niyam_id,
          media,
        });
      }
    });
    repaired += 1;
  }
  console.log(`Awards replayed: ${repaired}`);

  let streaksDone = 0;
  for (const pair of byStudentNiyam.values()) {
    await db.transaction(async (tx) => {
      const streak = await recomputeStreak(
        pair.studentId,
        pair.niyamId,
        pair.type as NiyamPeriodType,
        tx,
      );
      await awardNewlyReachedBadges(
        {
          studentId: pair.studentId,
          niyamId: pair.niyamId,
          niyamType: pair.type as NiyamPeriodType,
          currentStreak: streak.current,
          awardedBy: null,
        },
        tx,
      );
    });
    streaksDone += 1;
  }
  console.log(`Streaks recomputed / badges reconciled: ${streaksDone}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
