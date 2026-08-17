/**
 * Super-only "Impersonate" row action (SUP-API-03).
 *
 * POST /v1/admin/impersonate/:userId was built, audited and banner-wired, but
 * no UI ever started it — the whole feature was reachable only via curl. On
 * success the auth cookies now belong to the SUBJECT, so we hard-navigate to
 * /admin and let the app boot as them (the banner offers the way back).
 */
import { useState } from 'react';
import { apiPost, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { toast } from '@/components/ui/toast-jp';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from '@/components/ui/dialog';

export function ImpersonateButton({
  userId,
  name,
  role,
}: {
  userId: string | null | undefined;
  name: string | null | undefined;
  /** Subject's role when known — super_admin targets are refused server-side anyway. */
  role?: string | null;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (user?.role !== 'super_admin') return null;
  if (!userId || userId === user.id || role === 'super_admin') return null;

  async function start() {
    setBusy(true);
    try {
      await apiPost(`/v1/admin/impersonate/${userId}`, {});
      // Cookies now belong to the subject — reboot the app as them.
      window.location.assign('/admin');
    } catch (err) {
      setBusy(false);
      toast.error('Could not start impersonation.', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Impersonate
      </Button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Impersonate {name ?? 'this user'}?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          You will see the app exactly as they do, and every action you take is recorded in the
          audit trail against both accounts. Use the banner at the top to stop and return to your
          own account.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="button" disabled={busy} onClick={() => void start()}>
            {busy ? 'Starting…' : 'Impersonate'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
