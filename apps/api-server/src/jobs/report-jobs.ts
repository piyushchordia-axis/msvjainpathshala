/**
 * report.generation — centre monthly aggregate PDF (trustee-safe, no student names).
 */
import { db, centre_monthly_reports } from "@workspace/db";
import { eq } from "drizzle-orm";
import { QUEUE_NAMES } from "@jp/shared/constants";
import { registerQueueHandler } from "../lib/queues";
import { generateCentreMonthlyReport } from "../lib/centre-monthly-report";
import { storage, makeKey } from "../lib/storage";
import { logger } from "../lib/logger";

let registered = false;

export async function processCentreMonthlyReport(data: {
  report_id: string;
}): Promise<void> {
  const reportId = String(data.report_id ?? "");
  if (!reportId) throw new Error("report.generation missing report_id");

  const [row] = await db
    .select({
      id: centre_monthly_reports.id,
      centre_id: centre_monthly_reports.centre_id,
      month: centre_monthly_reports.month,
      status: centre_monthly_reports.status,
    })
    .from(centre_monthly_reports)
    .where(eq(centre_monthly_reports.id, reportId))
    .limit(1);

  if (!row) {
    logger.warn({ reportId }, "report.generation — row missing");
    return;
  }
  if (row.status === "ready") return;

  await db
    .update(centre_monthly_reports)
    .set({ status: "generating", updated_at: new Date(), error_message: null })
    .where(eq(centre_monthly_reports.id, reportId));

  try {
    const { snapshot, pdf } = await generateCentreMonthlyReport(row.centre_id, row.month);
    const key = makeKey("reports", `centre-${row.month}.pdf`);
    const stored = await storage.put(key, pdf, "application/pdf");
    await db
      .update(centre_monthly_reports)
      .set({
        status: "ready",
        pdf_url: stored.url,
        snapshot: snapshot as unknown as Record<string, unknown>,
        error_message: null,
        updated_at: new Date(),
      })
      .where(eq(centre_monthly_reports.id, reportId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err, reportId }, "report.generation failed");
    await db
      .update(centre_monthly_reports)
      .set({
        status: "failed",
        error_message: message.slice(0, 500),
        updated_at: new Date(),
      })
      .where(eq(centre_monthly_reports.id, reportId));
    throw err;
  }
}

export function registerReportJobs(): void {
  if (registered) return;
  registered = true;
  registerQueueHandler(QUEUE_NAMES.REPORT_GENERATION, async (data) => {
    await processCentreMonthlyReport({
      report_id: String((data as { report_id?: string }).report_id ?? ""),
    });
  });
}
