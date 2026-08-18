import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ConfirmRequest {
  title: string;
  /** What will happen, in the admin's terms — not the database's. */
  body: ReactNode;
  /** What the confirming button says. Name the action, never "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

/**
 * A styled confirm the caller can await, in place of window.confirm.
 *
 * The admin library asked seven questions through the browser's native dialog,
 * in database language — "Soft-delete this entry? It will disappear from the
 * admin tree." That names an implementation detail (the soft part), describes
 * the wrong consequence (the admin tree, not the public site), says nothing
 * about what the entry contains, and offers no way back. The app already had a
 * styled AlertDialog, used on three other admin pages.
 *
 * Kept imperative — `if (!(await confirm({...}))) return;` — because that is
 * the shape the call sites already had, so replacing them cannot change any
 * control flow by accident.
 */
export function useConfirm(): {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  confirmDialog: ReactNode;
} {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmRequest) => {
    setRequest(next);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    setRequest(null);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    // Dismissing is a "no". Leaving the promise unsettled would hang whatever
    // was awaiting it, and the caller would never re-enable its button.
    resolve?.(ok);
  }, []);

  const confirmDialog = (
    <AlertDialog
      open={!!request}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title ?? ""}</AlertDialogTitle>
          {/* asChild so the body can be several paragraphs. text-foreground
              overrides the primitive's muted default — otherwise the sentence
              that matters and the reassurance beneath it read as equally
              unimportant. */}
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-foreground">{request?.body}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>
            {request?.cancelLabel ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => settle(true)}
            className={
              request?.destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
          >
            {request?.confirmLabel ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, confirmDialog };
}

/**
 * "contains 3 subsections and 41 items", or null when it contains nothing.
 *
 * The counts are the whole reason to ask: deleting a section with forty stavans
 * under it is a different decision from deleting an empty one, and the old
 * dialog presented them identically.
 */
export function describeContents(counts: Array<[number, string, string]>): string | null {
  const parts = counts
    .filter(([n]) => n > 0)
    .map(([n, singular, plural]) => `${n} ${n === 1 ? singular : plural}`);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
