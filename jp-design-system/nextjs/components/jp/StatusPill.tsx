import * as React from 'react';
import { cn } from '@/lib/utils';

export type StatusPillVariant =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'neutral';

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Localized label — comes from i18n. */
  label: string;
  variant?: StatusPillVariant;
  /** Show the leading state dot. */
  withDot?: boolean;
  size?: 'sm' | 'md';
}

const variantClasses: Record<StatusPillVariant, string> = {
  success: 'bg-status-success-soft text-status-success',
  warning: 'bg-status-warning-soft text-status-warning',
  error:   'bg-status-error-soft text-status-error',
  info:    'bg-status-info-soft text-status-info',
  neutral: 'bg-status-neutral-soft text-status-neutral',
};

const sizeClasses = {
  sm: 'px-2 py-0.5 text-[10px]',
  md: 'px-2.5 py-0.5 text-xs',
};

export function StatusPill({
  label,
  variant = 'neutral',
  withDot = true,
  size = 'md',
  className,
  ...rest
}: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill font-semibold',
        sizeClasses[size],
        variantClasses[variant],
        className,
      )}
      {...rest}
    >
      {withDot && (
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-current"
        />
      )}
      {label}
    </span>
  );
}
