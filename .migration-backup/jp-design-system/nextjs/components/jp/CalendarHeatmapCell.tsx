import * as React from 'react';
import { cn } from '@/lib/utils';

export type HeatmapIntensity = 0 | 1 | 2 | 3 | 4;

export interface CalendarHeatmapCellProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value'> {
  /** 0–4 intensity bucket (0 = empty). */
  intensity: HeatmapIntensity;
  /** ISO date or any string id; echoed via `data-date` and to onClick. */
  date: string;
  /**
   * Required localized aria-label, e.g.
   * "5 May 2026 — 3 sessions" / "५ मई २०२६ — ३ सत्र".
   */
  ariaLabel: string;
  /** Mark this cell as "today". */
  today?: boolean;
  /** Mark this cell as outside the visible month (rendered faded). */
  outsideMonth?: boolean;
  size?: 'xs' | 'sm' | 'md';
  /** Color ramp — defaults to the saffron progression. */
  ramp?: 'saffron' | 'success' | 'gold';
}

const sizeClasses = {
  xs: 'size-2.5 rounded-[3px]',
  sm: 'size-3 rounded-[4px]',
  md: 'size-4 rounded-sm',
};

const rampClasses: Record<NonNullable<CalendarHeatmapCellProps['ramp']>, Record<HeatmapIntensity, string>> = {
  saffron: {
    0: 'bg-muted',
    1: 'bg-saffron-50',
    2: 'bg-saffron-300/60',
    3: 'bg-saffron-300',
    4: 'bg-saffron',
  },
  success: {
    0: 'bg-muted',
    1: 'bg-status-success-soft',
    2: 'bg-status-success/30',
    3: 'bg-status-success/60',
    4: 'bg-status-success',
  },
  gold: {
    0: 'bg-muted',
    1: 'bg-gold-50',
    2: 'bg-gold-300/60',
    3: 'bg-gold-300',
    4: 'bg-gold',
  },
};

export function CalendarHeatmapCell({
  intensity,
  date,
  ariaLabel,
  today,
  outsideMonth,
  size = 'sm',
  ramp = 'saffron',
  className,
  ...rest
}: CalendarHeatmapCellProps) {
  return (
    <button
      type="button"
      data-date={date}
      data-intensity={intensity}
      aria-label={ariaLabel}
      className={cn(
        'transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        sizeClasses[size],
        rampClasses[ramp][intensity],
        today &&
          'ring-2 ring-primary ring-offset-1 ring-offset-background',
        outsideMonth && 'opacity-40',
        className,
      )}
      {...rest}
    />
  );
}
