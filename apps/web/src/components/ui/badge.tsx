import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-foreground ring-accent',
        success: 'bg-status-success-soft text-status-success ring-status-success/40',
        warning: 'bg-status-warning-soft text-status-warning ring-status-warning/40',
        error: 'bg-status-error-soft text-status-error ring-status-error/40',
        info: 'bg-status-info-soft text-status-info ring-status-info/40',
        neutral: 'bg-cream-dark text-ink-sub ring-border',
        outline: 'bg-transparent text-foreground ring-border',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
