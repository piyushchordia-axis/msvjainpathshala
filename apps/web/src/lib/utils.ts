import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * `cn` — the standard shadcn/Tailwind class merger. `clsx` builds the
 * string from conditionals, `twMerge` resolves conflicts so a later
 * `bg-cream` wins over an earlier `bg-saffron`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
