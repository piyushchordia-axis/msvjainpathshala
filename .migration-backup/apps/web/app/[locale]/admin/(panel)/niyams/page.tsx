/**
 * Admin → Niyams (`/admin/niyams`).
 *
 * Lists every active niyam in the admin's city/centre/batch scope. Tap a
 * row → submissions grid for that niyam (Q5 reject window).
 *
 * Layout matches `jp-design-system/preview/admin-table.html` — narrow
 * column cadence, soft cream header, status pills.
 */

import Link from 'next/link';

import { listAdminNiyams, type NiyamRow } from '@/api/niyams';
import { Card } from '@/components/ui/card';

export default async function AdminNiyamsPage() {
  let items: NiyamRow[] = [];
  let error: string | null = null;
  try {
    const res = await listAdminNiyams();
    items = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load niyams.';
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">Niyams</h2>
          <p className="text-sm text-muted-foreground">
            Each row links to the submissions grid for review. Rejections within 30 days reverse
            Punya and hide gallery items.
          </p>
        </div>
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
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Points</th>
                <th className="px-4 py-3">Audience</th>
                <th className="px-4 py-3">Start</th>
                <th className="px-4 py-3">End</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                    No niyams yet. Create one from the mobile shikshak flow.
                  </td>
                </tr>
              ) : (
                items.map((n) => (
                  <tr key={n.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{n.title_en}</div>
                      <div className="text-xs text-muted-foreground">{n.title_hi}</div>
                    </td>
                    <td className="px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">
                      {n.type}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">+{n.points_value}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {n.audience_kind === 'msv_only' ? (
                        <span className="rounded-pill bg-gold/15 px-2 py-0.5 font-semibold text-gold">
                          MSV
                        </span>
                      ) : (
                        n.audience_kind
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">{n.start_date}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{n.end_date ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/niyams/${n.id}/submissions`}
                        className="text-sm font-semibold text-primary hover:underline"
                      >
                        Submissions →
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
