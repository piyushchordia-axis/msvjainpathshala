import * as React from 'react';
import { cn } from '@/lib/utils';

export type Role =
  | 'super'
  | 'cityAdmin'
  | 'sanchalak'
  | 'didi'
  | 'parent'
  | 'student';

export interface RoleBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  role: Role;
  /** Localized label e.g. "City Admin" / "नगर व्यवस्थापक". */
  label: string;
  size?: 'sm' | 'md';
  variant?: 'soft' | 'solid' | 'outline';
}

const softClasses: Record<Role, string> = {
  super:     'bg-tier-tirthankar/10 text-tier-tirthankar ring-1 ring-tier-tirthankar/30',
  cityAdmin: 'bg-secondary/10 text-secondary',
  sanchalak: 'bg-tier-sadhak/10 text-tier-sadhak',
  didi:      'bg-tier-shravak/10 text-tier-shravak',
  parent:    'bg-muted text-ink-sub',
  student:   'bg-accent text-primary',
};

const solidClasses: Record<Role, string> = {
  super:     'bg-tier-tirthankar text-white',
  cityAdmin: 'bg-secondary text-secondary-foreground',
  sanchalak: 'bg-tier-sadhak text-white',
  didi:      'bg-tier-shravak text-white',
  parent:    'bg-ink-sub text-white',
  student:   'bg-primary text-primary-foreground',
};

const outlineClasses: Record<Role, string> = {
  super:     'ring-1 ring-tier-tirthankar text-tier-tirthankar',
  cityAdmin: 'ring-1 ring-secondary text-secondary',
  sanchalak: 'ring-1 ring-tier-sadhak text-tier-sadhak',
  didi:      'ring-1 ring-tier-shravak text-tier-shravak',
  parent:    'ring-1 ring-border text-ink-sub',
  student:   'ring-1 ring-primary text-primary',
};

const sizeClasses = {
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2 py-0.5 text-xs',
};

export function RoleBadge({
  role,
  label,
  size = 'md',
  variant = 'soft',
  className,
  ...rest
}: RoleBadgeProps) {
  const variantMap = { soft: softClasses, solid: solidClasses, outline: outlineClasses };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm font-semibold uppercase tracking-wide',
        sizeClasses[size],
        variantMap[variant][role],
        className,
      )}
      {...rest}
    >
      {label}
    </span>
  );
}
