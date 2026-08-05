import {
  Children,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
  /** Estimate row height for the virtualiser (default 52). */
  estimateRowHeight?: number;
  /** Scroll viewport max height when virtualising (default 560). */
  maxHeight?: number;
  /** Virtualise when row count exceeds this (default 40). */
  virtualizeAbove?: number;
}

export function AdminTable({
  columns,
  loading,
  empty,
  colSpan,
  children,
  footer,
  estimateRowHeight = 52,
  maxHeight = 560,
  virtualizeAbove = 40,
}: AdminTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rows = Children.toArray(children).filter(Boolean) as ReactElement[];
  const shouldVirtualize = !loading && rows.length > virtualizeAbove;

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? rows.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 10,
  });

  const virtualItems = shouldVirtualize ? virtualizer.getVirtualItems() : [];
  const paddingTop = virtualItems.length > 0 ? virtualItems[0]!.start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1]!.end
      : 0;

  return (
    <Card className="overflow-hidden p-0">
      <div
        ref={parentRef}
        className="overflow-auto"
        style={shouldVirtualize ? { maxHeight } : undefined}
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted/95 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
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
            ) : rows.length === 0 ? (
              empty ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-8 text-center text-muted-foreground">
                    {empty}
                  </td>
                </tr>
              ) : null
            ) : shouldVirtualize ? (
              <>
                {paddingTop > 0 ? (
                  <tr aria-hidden>
                    <td colSpan={colSpan} style={{ height: paddingTop, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
                {virtualItems.map((v) => rows[v.index])}
                {paddingBottom > 0 ? (
                  <tr aria-hidden>
                    <td colSpan={colSpan} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
              </>
            ) : (
              rows
            )}
          </tbody>
        </table>
      </div>
      {!loading && footer}
    </Card>
  );
}

/** Virtualised CSS grid for admin image galleries (PERF #24). */
export function AdminVirtualGrid({
  count,
  columns = 3,
  estimateRowHeight = 280,
  maxHeight = 720,
  gapPx = 16,
  renderItem,
}: {
  count: number;
  columns?: number;
  estimateRowHeight?: number;
  maxHeight?: number;
  gapPx?: number;
  renderItem: (index: number) => ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowCount = Math.ceil(count / columns) || 0;
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateRowHeight + gapPx,
    overscan: 3,
  });

  if (count === 0) return null;

  // Small grids: no virtualisation overhead.
  if (count <= columns * 4) {
    return (
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: count }, (_, i) => (
          <div key={i}>{renderItem(i)}</div>
        ))}
      </div>
    );
  }

  return (
    <div ref={parentRef} className="overflow-auto" style={{ maxHeight }}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const start = row.index * columns;
          return (
            <div
              key={row.key}
              className="absolute left-0 grid w-full gap-4"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                transform: `translateY(${row.start}px)`,
                height: estimateRowHeight,
              }}
            >
              {Array.from({ length: columns }, (_, col) => {
                const idx = start + col;
                if (idx >= count) return <div key={col} />;
                return <div key={idx}>{renderItem(idx)}</div>;
              })}
            </div>
          );
        })}
      </div>
    </div>
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
