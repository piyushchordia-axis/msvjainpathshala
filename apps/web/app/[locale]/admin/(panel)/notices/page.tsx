/**
 * Admin → Notices index (`/admin/notices`).
 *
 * Lists all notices in the admin's city — pinned first, then by published_at.
 * Linkbar to /admin/notices/new for the bilingual composer.
 */

import Link from 'next/link';

import { listAdminNotices, type NoticeRow } from '@/api/notices';
import { Card } from '@/components/ui/card';

export default async function AdminNoticesPage() {
  let items: NoticeRow[] = [];
  let error: string | null = null;
  try {
    const res = await listAdminNotices();
    items = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load notices.';
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">Notices</h2>
          <p className="text-sm text-muted-foreground">
            Compose new notices, schedule ahead of time, or pin existing ones to the top of the
            feed.
          </p>
        </div>
        <Link
          href="/admin/notices/new"
          className="inline-flex items-center gap-2 rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700"
        >
          + New notice
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
                <th className="px-4 py-3">Content (EN)</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Flags</th>
                <th className="px-4 py-3">Published</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    No notices in your city yet.
                  </td>
                </tr>
              ) : (
                items.map((n) => (
                  <tr key={n.id} className="border-t border-border/60">
                    <td className="px-4 py-3">
                      <div className="line-clamp-2 max-w-md text-sm text-ink">{n.content_en}</div>
                      <div className="line-clamp-1 text-xs text-muted-foreground">
                        {n.content_hi}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs uppercase text-muted-foreground">{n.scope}</td>
                    <td className="px-4 py-3">
                      {n.published_at ? (
                        <span className="inline-flex items-center rounded-sm bg-success-bg px-2 py-0.5 text-xs font-semibold text-success">
                          Published
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-sm bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning">
                          Scheduled
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="flex flex-wrap gap-1">
                        {n.pinned ? <Badge tone="saffron">Pinned</Badge> : null}
                        {n.is_critical ? <Badge tone="error">Critical</Badge> : null}
                        {n.send_sms ? <Badge tone="warning">SMS</Badge> : null}
                        {n.is_public ? <Badge tone="info">Public</Badge> : null}
                        {n.msv_only ? <Badge tone="info">MSV</Badge> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {n.published_at ? new Date(n.published_at).toLocaleString() : '—'}
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

function Badge({
  tone,
  children,
}: {
  tone: 'saffron' | 'error' | 'warning' | 'info';
  children: React.ReactNode;
}) {
  const palette: Record<typeof tone, string> = {
    saffron: 'bg-saffron-50 text-saffron-700',
    error: 'bg-destructive/10 text-destructive',
    warning: 'bg-warning-bg text-warning',
    info: 'bg-info-bg text-info',
  };
  return (
    <span
      className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase ${palette[tone]}`}
    >
      {children}
    </span>
  );
}
