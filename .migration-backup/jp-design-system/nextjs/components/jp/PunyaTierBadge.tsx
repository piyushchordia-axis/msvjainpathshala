import * as React from 'react';
import { cn } from '@/lib/utils';

export type PunyaTier =
  | 'jigyasu'
  | 'shravak'
  | 'sadhak'
  | 'shraman'
  | 'tirthankar';

export interface PunyaTierBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  tier: PunyaTier;
  /** Localized tier name (e.g. "श्रावक" / "Shravak"). */
  label: string;
  withDot?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const tierClasses: Record<PunyaTier, string> = {
  jigyasu:    'bg-tier-jigyasu/10 text-tier-jigyasu',
  shravak:    'bg-tier-shravak/10 text-tier-shravak',
  sadhak:     'bg-tier-sadhak/10 text-tier-sadhak',
  shraman:    'bg-tier-shraman/10 text-tier-shraman',
  tirthankar: 'bg-tier-tirthankar/15 text-tier-tirthankar ring-1 ring-tier-tirthankar/30',
};

const sizeClasses = {
  sm: 'px-2 py-0.5 text-[11px]',
  md: 'px-2.5 py-1 text-xs',
  lg: 'px-3 py-1.5 text-sm',
};

export function PunyaTierBadge({
  tier,
  label,
  withDot = true,
  size = 'md',
  className,
  ...rest
}: PunyaTierBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill font-display',
        sizeClasses[size],
        tierClasses[tier],
        className,
      )}
      {...rest}
    >
      {withDot && (
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
      )}
      {label}
    </span>
  );
}
