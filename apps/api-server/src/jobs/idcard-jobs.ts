/**
 * idcard.generation queue — chunked bulk PNG renders (PERF #12).
 * Chunks are independently retryable; one chunk failure does not drop siblings.
 */
import { db, digital_id_cards, students, centres } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { QUEUE_NAMES } from "@jp/shared/constants";
import { registerQueueHandler } from "../lib/queues";
import { upsertIdCardArt } from "../lib/idcard-render";
import { bumpIdCardBulkJob } from "../lib/idcard-bulk-progress";
import { logger } from "../lib/logger";

export const IDCARD_CHUNK_SIZE = 50;

let registered = false;

export async function processIdCardGenerationChunk(data: {
  batch_id: string;
  student_ids: string[];
  only_missing: boolean;
}): Promise<{ generated: number; skipped: number; failed: number }> {
  const studentIds = [...new Set(data.student_ids)].filter(Boolean);
  if (studentIds.length === 0) {
    bumpIdCardBulkJob(data.batch_id, {});
    return { generated: 0, skipped: 0, failed: 0 };
  }

  const existingRows = await db
    .select({ student_id: digital_id_cards.student_id })
    .from(digital_id_cards)
    .where(inArray(digital_id_cards.student_id, studentIds));
  const existing = new Set(existingRows.map((r) => r.student_id));

  const studentRows = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      student_code: students.student_code,
      msv_status: students.msv_status,
      photo_url: students.photo_url,
      centre_name: centres.name,
    })
    .from(students)
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .where(
      and(
        inArray(students.id, studentIds),
        isNull(students.deleted_at),
        eq(students.status, "active"),
      ),
    );

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const student of studentRows) {
    try {
      if (data.only_missing && existing.has(student.id)) {
        skipped += 1;
        continue;
      }
      await upsertIdCardArt({
        studentId: student.id,
        fullName: student.full_name ?? student.student_code,
        studentCode: student.student_code,
        centreName: student.centre_name ?? "—",
        msvBadge: student.msv_status === "approved",
        photoUrl: student.photo_url,
        rotateQr: true,
      });
      generated += 1;
    } catch (err) {
      failed += 1;
      logger.warn(
        { err, studentId: student.id, batchId: data.batch_id },
        "idcard.generation chunk student failed",
      );
    }
  }

  bumpIdCardBulkJob(data.batch_id, { generated, skipped, failed });
  return { generated, skipped, failed };
}

export function registerIdCardJobs(): void {
  if (registered) return;
  registered = true;

  registerQueueHandler(QUEUE_NAMES.IDCARD_GENERATION, async (data) => {
    const batchId = String((data as { batch_id?: string }).batch_id ?? "");
    const onlyMissing = Boolean((data as { only_missing?: boolean }).only_missing);
    const raw = (data as { student_ids?: unknown }).student_ids;
    const studentIds = Array.isArray(raw)
      ? raw.map((id) => String(id)).filter(Boolean)
      : [];
    if (!batchId || studentIds.length === 0) {
      throw new Error("idcard.generation missing batch_id or student_ids");
    }
    try {
      await processIdCardGenerationChunk({
        batch_id: batchId,
        student_ids: studentIds,
        only_missing: onlyMissing,
      });
    } catch (err) {
      bumpIdCardBulkJob(batchId, { jobFailed: true });
      throw err;
    }
  });
}
