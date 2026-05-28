/**
 * Admin → Niyam submissions (`/admin/niyams/[id]/submissions`).
 *
 * Layout matches `jp-design-system/preview/admin-table.html`:
 *   - Sticky cream header row
 *   - Per-row status pill (admin-status-badges.html)
 *   - Reject button DISABLED after 30 days (Q5), with a tooltip
 *     "Rejection window closed".
 *   - Click Reject → modal with reason field min 20 chars.
 *
 * The reject form posts to `/api/admin/niyams/reject`. On 409
 * ERR_NIYAM_REVERSAL_WINDOW_EXPIRED we display the error inline.
 */

import { listAdminSubmissions, type NiyamSubmissionRow } from '@/api/niyams';
import { Card } from '@/components/ui/card';

import { SubmissionRow } from './submission-row';

interface Params {
  params: Promise<{ id: string; locale: string }>;
}

export default async function AdminNiyamSubmissionsPage({ params }: Params) {
  const { id } = await params;
  let items: NiyamSubmissionRow[] = [];
  let error: string | null = null;
  try {
    const res = await listAdminSubmissions({ niyam_id: id, limit: 100 });
    items = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load submissions.';
  }

  const niyamTitle = items[0]?.niyam_title_en ?? 'Niyam submissions';
  const niyamTitleHi = items[0]?.niyam_title_hi ?? null;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">{niyamTitle}</h2>
        {niyamTitleHi ? (
          <p className="font-display text-base text-muted-foreground">{niyamTitleHi}</p>
        ) : null}
        <p className="mt-1 text-sm text-muted-foreground">
          Submissions auto-approve on receipt. You can reject within 30 days — Punya reversal and
          gallery hide are atomic.
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
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Points</th>
                <th className="px-4 py-3">Proof</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    No submissions yet.
                  </td>
                </tr>
              ) : (
                items.map((row) => <SubmissionRow key={row.id} row={row} />)
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
