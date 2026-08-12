import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface PublishControlsProps {
  canPublish: boolean;
  isPublished: boolean;
  busy?: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
}

/** Publish / Unpublish — hidden unless canPublish (super_admin). */
export function PublishControls({
  canPublish,
  isPublished,
  busy,
  onPublish,
  onUnpublish,
}: PublishControlsProps) {
  if (!canPublish) return null;
  return (
    <div className="flex flex-wrap gap-2">
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
