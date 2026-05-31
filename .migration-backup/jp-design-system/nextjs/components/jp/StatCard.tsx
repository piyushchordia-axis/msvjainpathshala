import * as React from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type StatCardVariant = 'default' | 'muted' | 'primary';

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Localized label. */
  label: string;
  /** Value (string, number, or formatted ReactNode). */
  value: React.ReactNode;
  /** Optional icon slot — pass a lucide-react icon or any node. */
  icon?: React.ReactNode;
  /** Localized hint e.g. "this week". */
  hint?: string;
  variant?: StatCardVariant;
}

const variantClasses: Record<StatCardVariant, string> = {
  default: 'bg-card',
  muted:   'bg-muted',
  primary: 'bg-accent',
};

export function StatCard({
  label,
  value,
  icon,
  hint,
  variant = 'default',
  className,
  ...rest
}: StatCardProps) {
  return (
    <Card
      className={cn(
        'flex items-center gap-3 rounded-md border-border p-4 shadow-1',
        variantClasses[variant],
        className,
      )}
      {...rest}
    >
      {icon && (
        <div
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-accent text-primary"
        >
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-sub">
          {label}
        </p>
        <p className="font-display text-2xl leading-tight text-foreground">
          {value}
        </p>
        {hint && (
          <p className="mt-0.5 truncate text-[11px] text-ink-sub">{hint}</p>
        )}
      </div>
    </Card>
  );
}
