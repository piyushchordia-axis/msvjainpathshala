import type { ReportSnapshot } from '../../modules/reports/reports.service';
import type { ProgressReportPdfData, ProgressReportStat } from './pdf.service';

/** Map a progress-report JSON snapshot to PdfService input (shared by HTTP + workers). */
export function progressReportPdfFromSnapshot(
  snapshot: ReportSnapshot,
  centreName: string,
  shikshakComment: string | null,
  orgName = 'Megh Sanskar Vatika',
): ProgressReportPdfData {
  const stats: ProgressReportStat[] = [
    { label: 'Attendance', value: `${snapshot.attendance.rate_pct}%` },
    { label: 'Sessions', value: `${snapshot.attendance.present}/${snapshot.attendance.total}` },
    { label: 'Punya awarded', value: String(snapshot.punya.points_awarded) },
    { label: 'Reversals', value: String(snapshot.punya.reversals) },
  ];
  return {
    orgName,
    studentName: snapshot.student.full_name,
    studentCode: snapshot.student.student_code,
    centreName,
    periodKind: snapshot.period.kind,
    periodLabel: snapshot.period.label,
    generatedAt: new Date(),
    shikshakComment,
    stats,
  };
}
