/**
 * Admin → Punya audit (`/admin/punya/audit`).
 *
 * Three sections:
 *   1. Reconcile status card — last run + drift count + alert banner. A
 *      "Run reconcile now" button (super_admin only) calls the manual
 *      endpoint and refreshes the page.
 *   2. Drift details — table of every student touched in the last run with
 *      before/after totals.
 *   3. Run history — last 20 runs (Redis-backed).
 *
 * Matches `jp-design-system/preview/admin-audit.html` for the column
 * cadence and the soft-saffron header band on the section cards.
 */

import { lastReconcileRun, type ReconcileRunReport } from '@/api/punya';
import { Card } from '@/components/ui/card';

import { RunReconcileButton } from './run-reconcile-button';

export default async function AdminPunyaAuditPage() {
  let report: ReconcileRunReport | null = null;
  let error: string | null = null;
  try {
    report = await lastReconcileRun();
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load reconcile status.';
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">Punya audit</h2>
          <p className="text-sm text-muted-foreground">
            Ledger reconciliation status, recent reversals, and manual awards.
          </p>
        </div>
        <RunReconcileButton />
      </header>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <Card className={`p-5 ${report?.alerted ? 'border-destructive/40 bg-destructive/5' : ''}`}>
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-lg text-secondary">Last reconciliation</h3>
          {report ? (
            <span className="text-xs text-muted-foreground">
              {new Date(report.started_at).toLocaleString()}
            </span>
          ) : null}
        </div>
        {report ? (
          <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Drift rows" value={String(report.drift_count)} />
            <Stat label="Source" value={report.source} />
            <Stat label="Alerted" value={report.alerted ? 'Yes' : 'No'} />
            <Stat label="Run id" value={report.run_id} mono />
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No reconciliation run yet. Cron is scheduled for 03:00 IST daily; run manually below.
          </p>
        )}
      </Card>

      {report?.details && report.details.length > 0 ? (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border bg-muted/40 px-4 py-3">
            <h3 className="font-display text-lg text-secondary">Drift detail</h3>
            <p className="text-xs text-muted-foreground">
              Students whose projection didn't match the ledger sum. Each one was repaired in-place.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3 text-right">Before</th>
                  <th className="px-4 py-3 text-right">After</th>
                  <th className="px-4 py-3 text-right">Drift</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.details.map((row) => (
                  <tr key={row.student_id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs">{row.student_id}</td>
                    <td className="px-4 py-3 text-right">{row.before_total}</td>
                    <td className="px-4 py-3 text-right">{row.after_total}</td>
                    <td
                      className={`px-4 py-3 text-right font-semibold ${
                        row.drift_total > 0
                          ? 'text-success'
                          : row.drift_total < 0
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {row.drift_total > 0 ? '+' : ''}
                      {row.drift_total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-base font-semibold text-foreground ${mono ? 'font-mono text-xs break-all' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}
