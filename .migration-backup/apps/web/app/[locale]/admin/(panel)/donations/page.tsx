/**
 * Admin → Donations (`/admin/donations`, city_admin+).
 *
 * Read-only ledger of donations in scope. Rows are typed defensively.
 */

import { authenticatedServerClient } from '@/api/server-client';
import { Card } from '@/components/ui/card';

interface DonationRow {
  id: string;
  amount_paise?: number;
  currency?: string;
  purpose?: string;
  status?: string;
  donor_name?: string;
  created_at?: string;
}

function formatPaise(paise?: number): string {
  if (typeof paise !== 'number') return '—';
  const rupees = Math.round(paise / 100);
  if (rupees >= 100000) return `₹${(rupees / 100000).toFixed(1)}L`;
  if (rupees >= 1000) return `₹${(rupees / 1000).toFixed(1)}k`;
  return `₹${rupees}`;
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
}

async function load(): Promise<{ rows: DonationRow[]; error: string | null }> {
  try {
    const client = await authenticatedServerClient();
    const res = await client.get<{ data: { items: DonationRow[] } }>('/v1/admin/donations');
    return { rows: res.data.data.items ?? [], error: null };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : 'Could not load donations.' };
  }
}

export default async function DonationsPage() {
  const { rows, error } = await load();
  const captured = rows
    .filter((r) => r.status === 'captured')
    .reduce((sum, r) => sum + (r.amount_paise ?? 0), 0);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">Donations</h2>
        <p className="text-sm text-muted-foreground">
          Donations in your scope. Captured total shown below; 80G certificates are governed by
          platform settings.
        </p>
      </header>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : (
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Captured (shown)</p>
          <p className="font-display text-2xl text-secondary">{formatPaise(captured)}</p>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Donor</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Purpose</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    No donations in scope.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{r.donor_name ?? '—'}</td>
                    <td className="px-4 py-3 text-right">{formatPaise(r.amount_paise)}</td>
                    <td className="px-4 py-3 text-xs capitalize text-muted-foreground">
                      {r.purpose ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          r.status === 'captured'
                            ? 'rounded-pill bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700'
                            : 'rounded-pill bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground'
                        }
                      >
                        {r.status ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(r.created_at)}
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
