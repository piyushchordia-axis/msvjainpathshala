/**
 * shadcn-style Button (saffron primary).
 *
 * Variants:
 *   - default       — saffron CTA (jp-design-system/preview/buttons.html → Primary)
 *   - secondary     — maroon outline (Secondary)
 *   - ghost         — text-only saffron (Ghost)
 *   - destructive   — error palette
 *   - link          — inline link styling
 *
 * Sizes mirror the design-system spec:
 *   - default: 40px (compact admin density)
 *   - lg:      48px (Primary CTA per buttons.html)
 *   - sm:      32px (table actions)
 *   - icon:    square
 */

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ' +
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
    'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-2 hover:bg-saffron-700 active:scale-[0.98]',
        secondary:
          'border border-secondary bg-transparent text-secondary hover:bg-maroon-50 active:bg-maroon-50',
        ghost: 'text-primary hover:bg-accent active:bg-accent',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-card text-foreground hover:bg-muted',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
