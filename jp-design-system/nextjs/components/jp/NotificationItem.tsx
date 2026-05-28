import * as React from 'react';
import { cn } from '@/lib/utils';

export type NotificationKind =
  | 'notice'
  | 'punya'
  | 'attendance'
  | 'system';

export interface NotificationItemProps
  extends React.LiHTMLAttributes<HTMLLIElement> {
  /** Localized title. */
  title: string;
  /** Localized body / preview. */
  body?: string;
  /** Already-formatted localized time, e.g. "2 hr ago" / "अभी". */
  timeLabel: string;
  /** Drives the unread highlight + dot weight. */
  read?: boolean;
  /** Visual category — controls the leading dot color. */
  kind?: NotificationKind;
  /** Replace the leading slot entirely (avatar, icon, etc.). */
  leading?: React.ReactNode;
  /** Trailing slot for actions or extra metadata. */
  trailing?: React.ReactNode;
  /** Tap handler. */
  onOpen?: () => void;
}

const kindAccent: Record<NotificationKind, string> = {
  notice:     'bg-primary',
  punya:      'bg-gold',
  attendance: 'bg-status-success',
  system:     'bg-ink-sub',
};

export function NotificationItem({
  title,
  body,
  timeLabel,
  read,
  kind = 'notice',
  leading,
  trailing,
  onOpen,
  className,
  ...rest
}: NotificationItemProps) {
  return (
    <li
      className={cn(
        'group relative flex items-start gap-3 border-b border-cream-deeper px-4 py-3 transition-colors last:border-b-0',
        onOpen && 'cursor-pointer hover:bg-muted',
        !read && 'bg-accent/40',
        className,
      )}
      onClick={onOpen}
      {...rest}
    >
      <div className="mt-1.5 flex shrink-0 items-center justify-center">
        {leading ?? (
          <span
            aria-hidden
            className={cn('size-2 rounded-full', kindAccent[kind])}
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p
            className={cn(
              'truncate text-sm leading-snug text-foreground',
              read ? 'font-medium' : 'font-semibold',
            )}
          >
            {title}
          </p>
          <span className="ml-auto shrink-0 text-[11px] text-ink-sub">
            {timeLabel}
          </span>
        </div>
        {body && (
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-ink-sub">
            {body}
          </p>
        )}
      </div>

      {trailing && (
        <div className="shrink-0 self-center" onClick={(e) => e.stopPropagation()}>
          {trailing}
        </div>
      )}
    </li>
  );
}
