'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type AttendanceState = 'present' | 'absent' | 'late';

export interface AttendanceToggleOption {
  value: AttendanceState;
  /** Localized label. */
  label: string;
}

export interface AttendanceToggleProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** null/undefined = no selection. */
  value: AttendanceState | null;
  onChange: (next: AttendanceState | null) => void;
  /** Options + labels — required so caller controls i18n. */
  options: AttendanceToggleOption[];
  /** Tap a selected pill to clear it. */
  toggleable?: boolean;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Localized aria-label for the radio group. */
  ariaLabel?: string;
}

const stateClasses: Record<AttendanceState, string> = {
  present: 'bg-status-success text-white shadow-1',
  absent:  'bg-status-error text-white shadow-1',
  late:    'bg-status-warning text-white shadow-1',
};

const sizeClasses = {
  sm: 'px-2.5 py-1 text-[11px]',
  md: 'px-3.5 py-1.5 text-sm',
};

export function AttendanceToggle({
  value,
  onChange,
  options,
  toggleable = true,
  size = 'md',
  disabled,
  ariaLabel,
  className,
  ...rest
}: AttendanceToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-pill border border-border bg-muted p-1',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      {...rest}
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(selected && toggleable ? null : opt.value)}
            className={cn(
              'rounded-pill font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              sizeClasses[size],
              selected
                ? stateClasses[opt.value]
                : 'text-ink-sub hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
