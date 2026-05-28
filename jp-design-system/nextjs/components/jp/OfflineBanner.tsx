'use client';

import * as React from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type OfflineBannerSeverity = 'soft' | 'hard';

export interface OfflineBannerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Show / hide the banner. Drive this from a `useOnline()` hook. */
  open: boolean;
  /** Localized message e.g. "You're offline — changes will sync when back online." */
  label: string;
  /** Localized retry CTA copy. Omit to hide the button. */
  retryLabel?: string;
  onRetry?: () => void;
  /** soft = amber inline band; hard = red top-of-screen band. */
  severity?: OfflineBannerSeverity;
  /** Replace the leading icon. */
  icon?: React.ReactNode;
}

const severityClasses: Record<OfflineBannerSeverity, string> = {
  soft: 'border-status-warning/30 bg-status-warning-soft text-status-warning',
  hard: 'border-status-error bg-status-error text-white',
};

export function OfflineBanner({
  open,
  label,
  retryLabel,
  onRetry,
  severity = 'soft',
  icon,
  className,
  ...rest
}: OfflineBannerProps) {
  if (!open) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-2 border-b px-4 py-2 text-sm font-semibold',
        severityClasses[severity],
        className,
      )}
      {...rest}
    >
      <span aria-hidden className="shrink-0">
        {icon ?? <WifiOff className="size-4" />}
      </span>
      <span className="flex-1">{label}</span>
      {onRetry && retryLabel && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          className={cn(
            'h-7 gap-1',
            severity === 'hard' && 'text-white hover:bg-white/15 hover:text-white',
          )}
        >
          <RefreshCw aria-hidden className="size-3.5" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
