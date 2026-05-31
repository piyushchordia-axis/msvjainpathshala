/**
 * MSV applications — `/admin/msv-enrolments`.
 *
 * Pure admin discretion (Q1) — no eligibility logic in the UI either.
 * Reviewer reads the parent's note and approves / rejects / waitlists.
 */

import { authenticatedServerClient } from '@/api/server-client';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

type MsvStatus = 'applied' | 'waitlisted' | 'approved' | 'rejected' | 'revoked';

interface MsvEnrolment {
  id: string;
  student_id: string;
  motivation_statement_redacted: string | null;
  status: MsvStatus;
  decided_at: string | null;
  notes: string | null;
  created_at: string;
}

async function listMsv(): Promise<MsvEnrolment[]> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/msv/enrolments');
  return (res.data.data?.items ?? []) as MsvEnrolment[];
}

export default async function MsvEnrolmentsPage() {
  let items: MsvEnrolment[] = [];
  let error: string | null = null;
  try {
    items = await listMsv();
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load MSV applications.';
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">MSV applications</h2>
        <p className="text-sm text-muted-foreground">
          Pure admin discretion — no eligibility gates.
        </p>
      </header>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Note</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Decided</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    No MSV applications yet.
                  </td>
                </tr>
              ) : (
                items.map((m) => (
                  <tr key={m.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 text-foreground">
                      {new Date(m.created_at).toLocaleString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {m.student_id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {m.motivation_statement_redacted ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={m.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {m.decided_at
                        ? new Date(m.decided_at).toLocaleString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                          })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/msv-enrolments/${m.id}` as `/admin/msv-enrolments/${string}`}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
