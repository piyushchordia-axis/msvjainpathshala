import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface PublishControlsProps {
  canPublish: boolean;
  isPublished: boolean;
  /**
   * Published, but the draft has since moved. Both copies are already in the
   * DTO, so this costs nothing to know — see hasUnpublishedChanges.
   */
  hasChanges?: boolean;
  busy?: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
}

/**
 * Publish / Unpublish.
 *
 * For editors below super_admin the controls used to vanish entirely — no
 * draft/published state, no publish affordance, no explanation — so a
 * city_admin who finished a draft could not tell whether saving had published
 * it or what came next (CTY-DSN-01). They now see the state and a disabled
 * control naming the handoff.
 *
 * The third state was still missing: a PUBLISHED row whose draft had been
 * edited looked exactly like a clean one. Whoever made the edit had no way to
 * see it was outstanding, and the super_admin had nothing to notice.
 */
export function PublishControls({
  canPublish,
  isPublished,
  hasChanges = false,
  busy,
  onPublish,
  onUnpublish,
}: PublishControlsProps) {
  const badge = (
    <span
      className={
        isPublished
          ? "rounded-full bg-status-success-soft px-2 py-0.5 text-xs font-semibold text-status-success"
          : "rounded-full bg-status-warning-soft px-2 py-0.5 text-xs font-semibold text-status-warning"
      }
    >
      {isPublished ? "Published" : "Draft"}
    </span>
  );

  const changesBadge = hasChanges ? (
    <span
      className="rounded-full bg-status-warning-soft px-2 py-0.5 text-xs font-semibold text-status-warning"
      title="The saved draft differs from what the public sees."
    >
      Unpublished changes
    </span>
  ) : null;

  if (!canPublish) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {badge}
        {changesBadge}
        <Button type="button" size="sm" disabled title="Publishing is a super admin action">
          {isPublished ? "Unpublish" : "Publish"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {hasChanges
            ? "Saved. These edits are waiting for the national (super) admin to publish — the public still sees the previous version."
            : isPublished
              ? "Only the national (super) admin can unpublish — your saved changes stay in this published item until then."
              : "Saved. This draft is waiting for the national (super) admin to publish it."}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {badge}
      {changesBadge}
      {isPublished ? (
        <>
          {/* A diverged row needs Publish, not only Unpublish — otherwise the
              only way to ship an edit is to take the item down first. */}
          {hasChanges ? (
            <Button type="button" size="sm" disabled={busy} onClick={onPublish}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Publish changes
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onUnpublish}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Unpublish
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" disabled={busy} onClick={onPublish}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          Publish
        </Button>
      )}
    </div>
  );
}
