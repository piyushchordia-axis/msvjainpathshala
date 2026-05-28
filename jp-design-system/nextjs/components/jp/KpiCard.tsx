import * as React from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type KpiAccent = 'default' | 'primary' | 'success' | 'warning';

export interface KpiCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Localized label, uppercase eyebrow style. */
  label: string;
  /** Big value — pass a ReactNode if you need inline formatting. */
  value: React.ReactNode;
  /** Localized delta string e.g. "+8.2%". Omit to hide chip. */
  delta?: string;
  /** Arrow direction — visual only. */
  deltaDirection?: 'up' | 'down';
  /**
   * Is the delta good news?
   * Defaults to (deltaDirection === 'up'); override for cases like "fewer late
   * arrivals" where down is good.
   */
  deltaIsPositive?: boolean;
  /** Small caption below the chip e.g. "vs last month". */
  caption?: string;
  /** Accent the big value. */
  accent?: KpiAccent;
}

const accentClasses: Record<KpiAccent, string> = {
  default: 'text-foreground',
  primary: 'text-primary',
  success: 'text-status-success',
  warning: 'text-status-warning',
};

export function KpiCard({
  label,
  value,
  delta,
  deltaDirection = 'up',
  deltaIsPositive,
  caption,
  accent = 'default',
  className,
  ...rest
}: KpiCardProps) {
  const isGood = deltaIsPositive ?? deltaDirection === 'up';
  const Arrow = deltaDirection === 'up' ? ArrowUpRight : ArrowDownRight;

  return (
    <Card
      className={cn(
        'rounded-md border-border bg-card p-[18px] shadow-1',
        className,
      )}
      {...rest}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-sub">
        {label}
      </p>
      <p
        className={cn(
          'mt-1 font-display text-[36px] leading-[42px]',
          accentClasses[accent],
        )}
      >
        {value}
      </p>
      {(delta || caption) && (
        <div className="mt-2 flex items-center gap-2">
          {delta && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-pill px-2 py-0.5 text-[11px] font-semibold',
                isGood
                  ? 'bg-status-success-soft text-status-success'
                  : 'bg-status-error-soft text-status-error',
              )}
            >
              <Arrow className="size-2.5" aria-hidden />
              {delta}
            </span>
          )}
          {caption && (
            <span className="text-[11px] text-ink-sub">{caption}</span>
          )}
        </div>
      )}
    </Card>
  );
}
