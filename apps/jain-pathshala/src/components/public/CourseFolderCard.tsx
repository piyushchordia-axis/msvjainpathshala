/**
 * Top-level course catalogue card — folder/directory metaphor.
 * Do not use this for section / subsection rows.
 */
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { Folder } from 'lucide-react';
import { cn } from '@/lib/utils';

export function CourseFolderCard({
  title,
  subtitle,
  href,
  certificate,
  className,
}: {
  title: string;
  subtitle?: string | null;
  href: string;
  /** Course-level certificate affordance — right-aligned in the folder header. */
  certificate?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn('group block text-left', className)}
    >
      <span
        className="ml-3 block h-3 w-14 rounded-t-md border border-b-0 border-border bg-muted"
        aria-hidden
      />
      <span className="flex items-start gap-3 rounded-lg rounded-tl-sm border border-border bg-card p-4 transition group-hover:border-primary/40">
        <Folder
          className="mt-0.5 h-8 w-8 shrink-0 text-primary"
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block font-display text-lg text-secondary">{title}</span>
          {subtitle ? (
            <span className="mt-1 block text-sm text-muted-foreground">{subtitle}</span>
          ) : null}
        </span>
        {certificate ? (
          <span className="ml-auto shrink-0 self-start">{certificate}</span>
        ) : null}
      </span>
    </Link>
  );
}
