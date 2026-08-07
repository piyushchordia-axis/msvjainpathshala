/**
 * Centre monthly aggregate report — metrics snapshot + bilingual PDF.
 * Attendance via AT5 SQL only; homework via F4 SQL; no student names.
 */
import { db, centres, batches, students, sessions, enrolments, centre_holidays } from "@workspace/db";
import { and, asc, eq, gte, lte, isNull, sql, count } from "drizzle-orm";
import { getCentresAttendanceRate, getBatchAttendanceRates, rateToPercent1 } from "./attendance-rate";
import {
  getCentresHomeworkCompletionRate,
  getBatchHomeworkCompletionRates,
} from "./homework-completion-rate";
import { getCentresNiyamCompletionRate } from "./niyam-completion-rate";
import { PdfBuilder } from "./pdf";

const MONTH_RE = /^\d{4}-\d{2}$/;

export function isValidReportMonth(month: string): boolean {
  if (!MONTH_RE.test(month)) return false;
  const [y, m] = month.split("-").map(Number);
  return m! >= 1 && m! <= 12 && y! >= 2000 && y! <= 2100;
}

/** Inclusive Asia/Kolkata calendar bounds for YYYY-MM. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y!, m!, 0).getDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

export type BatchReportRow = {
  batch_id: string;
  batch_name: string;
  student_count: number;
  attendance_rate: number | null;
  attendance_pct: number | null;
  homework_rate: number | null;
  homework_pct: number | null;
};

export type CentreMonthlySnapshot = {
  centre_id: string;
  centre_name: string;
  month: string;
  from: string;
  to: string;
  no_sessions: boolean;
  attendance_rate: number | null;
  attendance_pct: number | null;
  niyam_rate: number | null;
  niyam_pct: number | null;
  homework_rate: number | null;
  homework_pct: number | null;
  punya_by_feature: Array<{ feature_key: string; points: number }>;
  punya_total: number;
  enrolment: { joined: number; deactivated: number; pending: number };
  sessions: { total: number; cancelled: number };
  holidays: number;
  batches: BatchReportRow[];
};

function pctOrNull(rate: number | null): number | null {
  if (rate == null) return null;
  return rateToPercent1(rate);
}

function formatPct(rate: number | null, emptyEn: string): string {
  if (rate == null) return emptyEn;
  return `${rateToPercent1(rate)}%`;
}

export async function composeCentreMonthlySnapshot(
  centreId: string,
  month: string,
): Promise<CentreMonthlySnapshot> {
  const { from, to } = monthBounds(month);
  const [centre] = await db
    .select({ id: centres.id, name: centres.name })
    .from(centres)
    .where(and(eq(centres.id, centreId), isNull(centres.deleted_at)))
    .limit(1);
  if (!centre) {
    throw new Error(`Centre ${centreId} not found`);
  }

  const centreIds = [centreId];

  const [attendanceRate, homeworkRate, niyamRate] = await Promise.all([
    getCentresAttendanceRate(centreIds, from, to),
    getCentresHomeworkCompletionRate(centreIds, from, to),
    getCentresNiyamCompletionRate(centreIds, from, to),
  ]);

  const sessionRows = await db
    .select({
      total: sql<number>`count(*)::int`,
      cancelled: sql<number>`count(*) filter (where ${sessions.status} = 'cancelled')::int`,
    })
    .from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .where(
      and(
        eq(batches.centre_id, centreId),
        gte(sessions.scheduled_date, from),
        lte(sessions.scheduled_date, to),
      ),
    );
  const sessionTotal = Number(sessionRows[0]?.total ?? 0);
  const sessionCancelled = Number(sessionRows[0]?.cancelled ?? 0);

  const [holidayRow] = await db
    .select({ n: count() })
    .from(centre_holidays)
    .where(
      and(
        eq(centre_holidays.centre_id, centreId),
        gte(centre_holidays.holiday_date, from),
        lte(centre_holidays.holiday_date, to),
      ),
    );

  const fromTs = new Date(`${from}T00:00:00+05:30`);
  const toTs = new Date(`${to}T23:59:59.999+05:30`);

  const [[joinedRow], [deactivatedRow], [pendingRow]] = await Promise.all([
    db
      .select({ n: count() })
      .from(enrolments)
      .where(
        and(
          eq(enrolments.requested_centre_id, centreId),
          eq(enrolments.status, "approved"),
          gte(enrolments.decided_at, fromTs),
          lte(enrolments.decided_at, toTs),
        ),
      ),
    db
      .select({ n: count() })
      .from(students)
      .where(
        and(
          eq(students.centre_id, centreId),
          isNull(students.deleted_at),
          gte(students.deactivated_at, fromTs),
          lte(students.deactivated_at, toTs),
        ),
      ),
    db
      .select({ n: count() })
      .from(enrolments)
      .where(
        and(eq(enrolments.requested_centre_id, centreId), eq(enrolments.status, "pending")),
      ),
  ]);

  const punyaResult = await db.execute(sql`
    select pt.feature_key, coalesce(sum(pt.points), 0)::int as points
    from punya_transactions pt
    inner join students st on st.id = pt.student_id
    where st.centre_id = ${centreId}::uuid
      and st.deleted_at is null
      and pt.created_at >= ${fromTs}
      and pt.created_at <= ${toTs}
    group by pt.feature_key
    order by points desc, pt.feature_key
  `);
  const punyaRows =
    (punyaResult as unknown as { rows?: Array<{ feature_key: string; points: number }> }).rows ??
    [];
  const punya_by_feature = punyaRows.map((r) => ({
    feature_key: String(r.feature_key),
    points: Number(r.points),
  }));
  const punya_total = punya_by_feature.reduce((s, r) => s + r.points, 0);

  // Every active batch (including those with no marks yet — null rate, not dropped).
  // Rates come from AT5 SRFs; LEFT JOIN semantics via Map lookup (not inline arithmetic).
  const batchMeta = await db
    .select({
      batch_id: batches.id,
      batch_name: batches.name,
      student_count: sql<number>`(
        select count(*)::int
        from students st2
        where st2.batch_id = ${batches.id}
          and st2.status = 'active'
          and st2.deleted_at is null
      )`,
    })
    .from(batches)
    .where(and(eq(batches.centre_id, centreId), isNull(batches.deleted_at)))
    .orderBy(asc(batches.name));

  const [attByBatch, hwByBatch] = await Promise.all([
    getBatchAttendanceRates(centreId, from, to),
    getBatchHomeworkCompletionRates(centreId, from, to),
  ]);

  const batchRows: BatchReportRow[] = batchMeta.map((r) => {
    const attendance_rate = attByBatch.get(r.batch_id) ?? null;
    const homework_rate = hwByBatch.get(r.batch_id) ?? null;
    return {
      batch_id: r.batch_id,
      batch_name: r.batch_name,
      student_count: Number(r.student_count ?? 0),
      attendance_rate,
      attendance_pct: pctOrNull(attendance_rate),
      homework_rate,
      homework_pct: pctOrNull(homework_rate),
    };
  });

  return {
    centre_id: centre.id,
    centre_name: centre.name,
    month,
    from,
    to,
    no_sessions: sessionTotal === 0,
    attendance_rate: attendanceRate,
    attendance_pct: pctOrNull(attendanceRate),
    niyam_rate: niyamRate,
    niyam_pct: pctOrNull(niyamRate),
    homework_rate: homeworkRate,
    homework_pct: pctOrNull(homeworkRate),
    punya_by_feature,
    punya_total,
    enrolment: {
      joined: Number(joinedRow?.n ?? 0),
      deactivated: Number(deactivatedRow?.n ?? 0),
      pending: Number(pendingRow?.n ?? 0),
    },
    sessions: { total: sessionTotal, cancelled: sessionCancelled },
    holidays: Number(holidayRow?.n ?? 0),
    batches: batchRows,
  };
}

export async function buildCentreMonthlyReportPdf(
  snap: CentreMonthlySnapshot,
): Promise<Buffer> {
  const pdf = await PdfBuilder.createBilingual();
  const monthLabel = snap.month;

  pdf.title("Centre monthly report / केंद्र मासिक रिपोर्ट");
  pdf.spacer(4);
  pdf.bilingual(`Centre: ${snap.centre_name}`, `केंद्र: ${snap.centre_name}`);
  pdf.bilingual(`Month: ${monthLabel}`, `माह: ${monthLabel}`);
  pdf.bilingual(`Period: ${snap.from} – ${snap.to}`, `अवधि: ${snap.from} – ${snap.to}`);
  pdf.hr();

  pdf.heading("Summary / सारांश");
  if (snap.no_sessions) {
    pdf.bilingual(
      "No sessions were scheduled or held at this centre in this month.",
      "इस माह इस केंद्र पर कोई सत्र निर्धारित या आयोजित नहीं हुआ।",
    );
    pdf.bilingual(
      "Attendance rate is not applicable (no sessions — not 0%).",
      "उपस्थिति दर लागू नहीं (कोई सत्र नहीं — 0% नहीं)।",
    );
  } else {
    pdf.keyValue(
      "Attendance / उपस्थिति",
      formatPct(snap.attendance_rate, "n/a — no countable marks"),
    );
  }
  pdf.keyValue(
    "Niyam completion / नियम पूर्णता",
    formatPct(snap.niyam_rate, "n/a — no submissions"),
  );
  pdf.keyValue(
    "Homework completion / गृहकार्य",
    formatPct(snap.homework_rate, "n/a — no homework set"),
  );
  pdf.keyValue("Sessions / सत्र", String(snap.sessions.total));
  pdf.keyValue("Cancelled / रद्द", String(snap.sessions.cancelled));
  pdf.keyValue("Holidays / अवकाश", String(snap.holidays));

  pdf.hr();
  pdf.heading("Enrolment movement / नामांकन गति");
  pdf.keyValue("Joined (approved) / जुड़े", String(snap.enrolment.joined));
  pdf.keyValue("Deactivated / निष्क्रिय", String(snap.enrolment.deactivated));
  pdf.keyValue("Pending / लंबित", String(snap.enrolment.pending));

  pdf.hr();
  pdf.heading("Punya by feature / पुण्य (feature_key)");
  if (snap.punya_by_feature.length === 0) {
    pdf.bilingual("No Punya earned this month.", "इस माह कोई पुण्य अर्जित नहीं हुआ।");
  } else {
    pdf.keyValue("Total / कुल", String(snap.punya_total));
    for (const row of snap.punya_by_feature) {
      pdf.keyValue(row.feature_key, String(row.points));
    }
  }

  pdf.hr();
  pdf.heading("Per batch / प्रति बैच");
  if (snap.batches.length === 0) {
    pdf.bilingual("No batches at this centre.", "इस केंद्र पर कोई बैच नहीं।");
  } else {
    for (const b of snap.batches) {
      const att =
        b.attendance_pct == null ? "n/a" : `${b.attendance_pct}%`;
      const hw = b.homework_pct == null ? "n/a" : `${b.homework_pct}%`;
      pdf.text(
        `${b.batch_name} — students ${b.student_count}, attendance ${att}, homework ${hw}`,
        10,
      );
    }
  }

  pdf.spacer(16);
  pdf.bilingual(
    "Aggregate centre summary — no individual student names.",
    "केंद्र सारांश — व्यक्तिगत विद्यार्थी नाम शामिल नहीं।",
    9,
  );

  return pdf.toBuffer();
}

/** Compose snapshot + PDF bytes for the worker. */
export async function generateCentreMonthlyReport(
  centreId: string,
  month: string,
): Promise<{ snapshot: CentreMonthlySnapshot; pdf: Buffer }> {
  const snapshot = await composeCentreMonthlySnapshot(centreId, month);
  const pdf = await buildCentreMonthlyReportPdf(snapshot);
  return { snapshot, pdf };
}
