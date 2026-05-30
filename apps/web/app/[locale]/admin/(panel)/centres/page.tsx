/**
 * Admin → Centres (`/admin/centres`).
 *
 * Read-only directory across the actor's scope. city_admin+ can create
 * via the API; the create flow ships separately.
 */

import { listAdminCentres, type CentreRow } from '@/api/admin-misc';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

import { CentreActions } from './centre-actions';

export default async function AdminCentresPage() {
  let items: CentreRow[] = [];
  let error: string | null = null;
  try {
    const res = await listAdminCentres();
    items = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load centres.';
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">Centres</h2>
          <p className="text-sm text-muted-foreground">
            Pathshala locations across your city. GPS radius bounds geofenced attendance.
          </p>
        </div>
        <Link
          href="/admin/centres/new"
          className="rounded-md bg-saffron px-3 py-2 text-sm font-semibold text-white hover:bg-saffron-700"
        >
          New centre
        </Link>
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
                <th className="px-4 py-3">Locality</th>
                <th className="px-4 py-3">Pincode</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3 text-right">Geo-fence (m)</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                    No centres yet.
                  </td>
                </tr>
              ) : (
                items.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{c.locality ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">{c.pincode ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">
                      {c.contact_phone ?? c.contact_email ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-xs">{c.gps_radius_m}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          c.status === 'active'
                            ? 'rounded-pill bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700'
                            : 'rounded-pill bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground'
                        }
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <CentreActions id={c.id} status={c.status} />
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
