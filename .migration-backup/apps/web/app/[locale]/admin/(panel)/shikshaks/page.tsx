/**
 * Admin → Shikshaks (`/admin/shikshaks`).
 *
 * City-scoped roster of Guruji / Didi (`GET /v1/admin/shikshaks`).
 * Onboarding still happens via the mobile sanchalak flow; this view is
 * read-only.
 */

import { listAdminShikshaks, type AdminShikshakRow } from '@/api/admin-misc';
import { Card } from '@/components/ui/card';

/** Address shikshaks as Guruji (male) / Didi (female) per DESIGN_GUIDE. */
function honorific(gender: string | null): string {
  if (gender === 'female') return 'Didi';
  if (gender === 'male') return 'Guruji';
  return 'Shikshak';
}

export default async function AdminShikshaksPage() {
  let items: AdminShikshakRow[] = [];
  let error: string | null = null;
  try {
    const res = await listAdminShikshaks();
    items = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load shikshaks.';
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">Shikshaks</h2>
        <p className="text-sm text-muted-foreground">
          Guruji and Didi across your scope. Onboarding runs through the mobile sanchalak flow.
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
                <th className="px-4 py-3">Honorific</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Default centre</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    No shikshaks in scope yet.
                  </td>
                </tr>
              ) : (
                items.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{s.full_name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-pill bg-saffron/10 px-2 py-0.5 text-xs font-semibold text-saffron">
                        {honorific(s.gender)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{s.phone}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {s.centre_id_default ?? '—'}
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
