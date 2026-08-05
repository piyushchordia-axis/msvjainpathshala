import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';

interface AdminPageShellProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function AdminPageShell({ title, subtitle, actions, children }: AdminPageShellProps) {
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">{title}</h2>
          {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}

interface AdminTableProps {
  columns: string[];
  loading?: boolean;
  empty: string;
  colSpan: number;
  children: ReactNode;
  footer?: ReactNode;
}

export function AdminTable({
  columns,
  loading,
  empty,
  colSpan,
  children,
  footer,
}: AdminTableProps) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th key={c} className="px-4 py-3">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={colSpan} className="px-4 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : (
              children
            )}
          </tbody>
        </table>
      </div>
      {!loading && footer}
    </Card>
  );
}

export function AdminError({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{message}</Card>
  );
}

export function AdminEmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-muted-foreground">
        {message}
      </td>
    </tr>
  );
}

/** PERF #21 — explicit next-page control (lists no longer auto-collect 50 pages). */
export function AdminLoadMore({
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  if (!hasMore) return null;
  return (
    <div className="border-t border-border p-3 text-center">
      <button
        type="button"
        className="rounded-md border border-border bg-background px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
        disabled={loadingMore}
        onClick={onLoadMore}
      >
        {loadingMore ? 'Loading…' : 'Load more'}
      </button>
    </div>
  );
}
