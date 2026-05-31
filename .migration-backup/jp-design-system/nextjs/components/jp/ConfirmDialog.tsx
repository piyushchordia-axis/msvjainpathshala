'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Localized title. */
  title: string;
  /** Localized description / body. */
  description?: string;
  /** Localized confirm CTA label. */
  confirmLabel: string;
  /** Localized cancel CTA label. */
  cancelLabel: string;
  /** Render confirm as destructive (red). */
  destructive?: boolean;
  /** Sync or async confirm handler — promise resolution closes the dialog. */
  onConfirm: () => void | Promise<void>;
  /** Externally drive the busy state; otherwise tracked internally. */
  busy?: boolean;
  /** Localized busy label e.g. "Saving…". Falls back to "…". */
  busyLabel?: string;
  /** Custom icon slot. Defaults to a warning glyph for destructive actions. */
  icon?: React.ReactNode;
  className?: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive,
  onConfirm,
  busy,
  busyLabel,
  icon,
  className,
}: ConfirmDialogProps) {
  const [internalBusy, setInternalBusy] = React.useState(false);
  const isBusy = busy ?? internalBusy;

  const handleConfirm = async () => {
    try {
      setInternalBusy(true);
      await onConfirm();
      onOpenChange(false);
    } finally {
      setInternalBusy(false);
    }
  };

  const defaultIcon = destructive ? (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-status-error-soft">
      <AlertTriangle aria-hidden className="size-5 text-status-error" />
    </div>
  ) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !isBusy && onOpenChange(next)}
    >
      <DialogContent className={cn('sm:max-w-md', className)}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            {icon ?? defaultIcon}
            <div className="flex-1">
              <DialogTitle className="font-display text-xl text-secondary">
                {title}
              </DialogTitle>
              {description && (
                <DialogDescription className="mt-1 text-sm text-ink-sub">
                  {description}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isBusy}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={isBusy}
          >
            {isBusy ? (busyLabel ?? '…') : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
