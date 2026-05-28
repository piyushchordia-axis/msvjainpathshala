import * as React from 'react';
import { Flame } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StreakState = 'live' | 'broken' | 'milestone';

export interface StreakBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Current streak length. */
  days: number;
  /** Localized unit label e.g. "day streak" / "दिनों की लड़ी". */
  unitLabel: string;
  /** live = active orange; broken = grayed; milestone = gold celebration. */
  state?: StreakState;
  size?: 'sm' | 'md' | 'lg';
  /** Replace the flame with a custom icon (e.g. trophy at 100 days). */
  icon?: React.ReactNode;
}

const stateClasses: Record<StreakState, string> = {
  live:      'bg-saffron-50 text-saffron',
  broken:    'bg-muted text-ink-dim',
  milestone: 'bg-gold-50 text-gold ring-1 ring-gold/30',
};

const sizeClasses = {
  sm: 'px-2 py-0.5 text-[11px] gap-1',
  md: 'px-2.5 py-1 text-xs gap-1.5',
  lg: 'px-3 py-1.5 text-sm gap-1.5',
};

const iconSize = { sm: 'size-3', md: 'size-3.5', lg: 'size-4' };

export function StreakBadge({
  days,
  unitLabel,
  state = 'live',
  size = 'md',
  icon,
  className,
  ...rest
}: StreakBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-pill font-semibold',
        sizeClasses[size],
        stateClasses[state],
        className,
      )}
      {...rest}
    >
      <span aria-hidden className={iconSize[size]}>
        {icon ?? <Flame className={iconSize[size]} />}
      </span>
      <span>
        <strong className="font-bold tabular-nums">{days}</strong>{' '}
        <span className="font-normal opacity-80">{unitLabel}</span>
      </span>
    </span>
  );
}
