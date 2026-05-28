import * as React from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type SortDirection = 'asc' | 'desc';

export interface DataGridColumn<TRow> {
  /** Unique key — usually a property of TRow, but free-form is fine. */
  key: string;
  /** Localized header label. */
  header: string;
  /** Custom cell renderer. Defaults to `(row as any)[key]`. */
  cell?: (row: TRow, index: number) => React.ReactNode;
  /** Enable the sort affordance on this column. */
  sortable?: boolean;
  /** Tailwind classes for column alignment / width. */
  className?: string;
  /** Header alignment. */
  align?: 'left' | 'right' | 'center';
}

export interface DataGridProps<TRow>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  columns: DataGridColumn<TRow>[];
  rows: TRow[];
  /** Stable key per row. Defaults to (row as any).id. */
  rowKey?: (row: TRow, index: number) => string | number;
  sortKey?: string;
  sortDirection?: SortDirection;
  onSortChange?: (key: string, direction: SortDirection) => void;
  onRowClick?: (row: TRow) => void;
  /** Localized empty-state copy. Required for i18n. */
  emptyLabel: string;
  /** Localized busy copy — shown while loading is true. */
  loadingLabel?: string;
  loading?: boolean;
  /** Render row hover / cursor as actionable. */
  interactive?: boolean;
}

const alignClasses = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

export function DataGrid<TRow>({
  columns,
  rows,
  rowKey,
  sortKey,
  sortDirection = 'asc',
  onSortChange,
  onRowClick,
  emptyLabel,
  loadingLabel,
  loading,
  interactive,
  className,
  ...rest
}: DataGridProps<TRow>) {
  const getKey = (row: TRow, i: number) =>
    rowKey
      ? rowKey(row, i)
      : ((row as unknown as { id?: string | number }).id ?? i);

  const toggleSort = (col: DataGridColumn<TRow>) => {
    if (!col.sortable || !onSortChange) return;
    const next: SortDirection =
      sortKey === col.key && sortDirection === 'asc' ? 'desc' : 'asc';
    onSortChange(col.key, next);
  };

  const showBody = !loading;
  const hasRows = rows.length > 0;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-border bg-card shadow-1',
        className,
      )}
      {...rest}
    >
      <Table>
        <TableHeader>
          <TableRow className="border-b border-cream-deeper bg-muted hover:bg-muted">
            {columns.map((col) => {
              const active = sortKey === col.key;
              const Arrow = active
                ? sortDirection === 'desc'
                  ? ChevronDown
                  : ChevronUp
                : ChevronsUpDown;
              return (
                <TableHead
                  key={col.key}
                  onClick={() => toggleSort(col)}
                  className={cn(
                    'h-10 text-[11px] font-bold uppercase tracking-wide text-secondary',
                    alignClasses[col.align ?? 'left'],
                    col.sortable && 'cursor-pointer select-none',
                    col.className,
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.sortable && (
                      <Arrow
                        aria-hidden
                        className={cn(
                          'size-3',
                          !active && 'opacity-30',
                        )}
                      />
                    )}
                  </span>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>

        <TableBody>
          {loading && loadingLabel && (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-ink-sub"
              >
                {loadingLabel}
              </TableCell>
            </TableRow>
          )}

          {showBody && !hasRows && (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-ink-sub"
              >
                {emptyLabel}
              </TableCell>
            </TableRow>
          )}

          {showBody &&
            hasRows &&
            rows.map((row, i) => (
              <TableRow
                key={getKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-cream-deeper text-sm last:border-b-0',
                  (onRowClick || interactive) &&
                    'cursor-pointer transition-colors hover:bg-cream',
                )}
              >
                {columns.map((col) => (
                  <TableCell
                    key={col.key}
                    className={cn(
                      'py-2.5',
                      alignClasses[col.align ?? 'left'],
                      col.className,
                    )}
                  >
                    {col.cell
                      ? col.cell(row, i)
                      : ((row as unknown as Record<string, React.ReactNode>)[
                          col.key
                        ] ?? null)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </div>
  );
}
