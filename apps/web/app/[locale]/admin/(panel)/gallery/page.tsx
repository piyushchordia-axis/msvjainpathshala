/**
 * Admin → Gallery (`/admin/gallery`).
 *
 * Feature / unfeature / remove with inline status filter
 * (visible | removed | featured). Status badge column matches
 * `jp-design-system/preview/admin-status-badges.html`.
 *
 * Removal requires a reason ≥ 20 chars and notifies the parent (handled
 * server-side via `notifications.fanout`).
 */

import { listAdminGallery, type AdminGalleryItem } from '@/api/niyams';
import { Card } from '@/components/ui/card';

import { GalleryRow } from './gallery-row';

interface SearchParams {
  searchParams?: Promise<{ status?: string }>;
}

export default async function AdminGalleryPage({ searchParams }: SearchParams) {
  const params = await searchParams;
  const rawStatus = params?.status;
  const status =
    rawStatus === 'removed' || rawStatus === 'featured' || rawStatus === 'visible'
      ? (rawStatus as 'removed' | 'featured' | 'visible')
      : undefined;

  let items: AdminGalleryItem[] = [];
  let error: string | null = null;
  try {
    const res = await listAdminGallery({ ...(status ? { status } : {}), limit: 100 });
    items = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load gallery.';
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">Gallery</h2>
          <p className="text-sm text-muted-foreground">
            Items derive from approved niyam submissions when the parent has opted in. Featured
            items rise to the top of the public city gallery.
          </p>
        </div>
        <StatusFilter active={status ?? 'all'} />
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
                <th className="px-4 py-3">Child</th>
                <th className="px-4 py-3">Niyam</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    No gallery items match this filter.
                  </td>
                </tr>
              ) : (
                items.map((row) => <GalleryRow key={row.id} row={row} />)
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StatusFilter({ active }: { active: string }) {
  const options: Array<{ value: string; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'visible', label: 'Visible' },
    { value: 'featured', label: 'Featured' },
    { value: 'removed', label: 'Removed' },
  ];
  return (
    <div className="inline-flex rounded-md border border-border bg-background p-1">
      {options.map((o) => {
        const isActive = o.value === active;
        const href = o.value === 'all' ? '/admin/gallery' : `/admin/gallery?status=${o.value}`;
        return (
          <a
            key={o.value}
            href={href}
            className={
              isActive
                ? 'rounded-sm bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground'
                : 'rounded-sm px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground'
            }
          >
            {o.label}
          </a>
        );
      })}
    </div>
  );
}
