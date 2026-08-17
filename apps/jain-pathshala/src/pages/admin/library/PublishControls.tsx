import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface PublishControlsProps {
  canPublish: boolean;
  isPublished: boolean;
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
 */
export function PublishControls({
  canPublish,
  isPublished,
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

  if (!canPublish) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {badge}
        <Button type="button" size="sm" disabled title="Publishing is a super admin action">
          {isPublished ? "Unpublish" : "Publish"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Only the national (super) admin can {isPublished ? "unpublish" : "publish"} — your
          saved changes stay in this {isPublished ? "published item" : "draft"} until then.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {badge}
      {isPublished ? (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onUnpublish}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          Unpublish
        </Button>
      ) : (
        <Button type="button" size="sm" disabled={busy} onClick={onPublish}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          Publish
        </Button>
      )}
    </div>
  );
}
