/**
 * Admin → Competitions index (`/admin/competitions`).
 *
 * Lists every competition in the admin's city. Each row links to the
 * results-entry page when `status='open'|'closed'`, or the read-only
 * summary when `status='results_published'`.
 */

import Link from 'next/link';

import { listAdminCompetitions, type CompetitionRow } from '@/api/competitions';
import { Card } from '@/components/ui/card';

export default async function AdminCompetitionsPage() {
  let items: CompetitionRow[] = [];
  let error: string | null = null;
  try {
    const res = await listAdminCompetitions();
    items = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load competitions.';
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">Competitions</h2>
        <p className="text-sm text-muted-foreground">
          Manage registration windows and publish results. Punya is awarded only on publish.
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
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Event date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Punya</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    No competitions yet.
                  </td>
                </tr>
              ) : (
                items.map((c) => (
                  <tr key={c.id} className="border-t border-border/60">
                    <td className="px-4 py-3">
                      <div className="text-sm text-ink">{c.name_en}</div>
                      <div className="text-xs text-muted-foreground">{c.name_hi}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {c.event_date ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-xs">
                      Winner +{c.winner_points}, Participants +{c.participant_points}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/competitions/${c.id}/results`}
                        className="text-sm font-semibold text-saffron hover:underline"
                      >
                        Results →
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

function StatusPill({ status }: { status: CompetitionRow['status'] }) {
  const map: Record<CompetitionRow['status'], { bg: string; fg: string; label: string }> = {
    draft: { bg: 'bg-muted', fg: 'text-muted-foreground', label: 'Draft' },
    open: { bg: 'bg-success-bg', fg: 'text-success', label: 'Open' },
    closed: { bg: 'bg-warning-bg', fg: 'text-warning', label: 'Closed' },
    results_published: { bg: 'bg-gold-50', fg: 'text-gold', label: 'Published' },
  };
  const s = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase ${s.bg} ${s.fg}`}
    >
      {s.label}
    </span>
  );
}
