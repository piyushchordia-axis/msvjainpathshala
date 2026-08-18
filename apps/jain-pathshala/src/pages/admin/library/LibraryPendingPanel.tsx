import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";
import { apiPost, ApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast-jp";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  pendingLibraryRows,
  type LibraryAdminSection,
  type PendingKind,
  type PendingLibraryRow,
} from "./library-admin-types";

interface Props {
  sections: LibraryAdminSection[];
  canPublish: boolean;
  onChanged: () => Promise<void>;
}

const PUBLISH_PATH: Record<PendingKind, string> = {
  section: "sections",
  subsection: "subsections",
  item: "items",
};

const KIND_LABEL: Record<PendingKind, string> = {
  section: "Section",
  subsection: "Subsection",
  item: "Item",
};

/** Where in the tree to go to look at this row. */
function hrefFor(row: PendingLibraryRow): string {
  return row.kind === "item"
    ? `/admin/library/items/${row.id}`
    : "/admin/library/sections";
}

/**
 * Everything still waiting to reach the public.
 *
 * §17.3 describes an approval concept that had no surface at all. An editor
 * below super_admin went create → edit → upload → nothing: no submit action, no
 * confirmation, and no way to tell whether anyone would ever look. On the other
 * side, the super_admin — the only role that can publish — had no list of what
 * was waiting, so work sat in drafts nobody knew existed.
 *
 * This is that list, derived from data the tree already carries: a row is
 * pending if it has never been published, or if it has and its draft has since
 * moved. No column, no migration, and nothing for anyone to forget to set.
 *
 * Shown to editors too, not only to super_admin: the person who wrote the
 * draft is the one who most wants to know it is still outstanding.
 */
export function LibraryPendingPanel({ sections, canPublish, onChanged }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const rows = useMemo(() => pendingLibraryRows(sections), [sections]);

  async function publish(row: PendingLibraryRow) {
    setBusyId(row.id);
    try {
      await apiPost(`/v1/admin/library/${PUBLISH_PATH[row.kind]}/${row.id}/publish`, {});
      await onChanged();
      toast.success(`${KIND_LABEL[row.kind]} published.`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not publish that — try again.",
      );
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Nothing is waiting — every section, subsection and item is published and matches its
        draft.
      </Card>
    );
  }

  const neverPublished = rows.filter((r) => !r.isPublished).length;
  const changed = rows.length - neverPublished;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {neverPublished} not published yet
        {changed > 0 ? `, ${changed} published with newer edits` : ""}.
        {canPublish
          ? " Publishing sends the current draft to the public."
          : " Publishing is a super admin action — this list is what you are waiting on."}
      </p>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Where</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.kind}-${row.id}`} className="border-t border-border">
                <td className="px-3 py-2">
                  <Link href={hrefFor(row)} className="text-primary hover:underline">
                    {row.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{row.where}</td>
                <td className="px-3 py-2 text-muted-foreground">{KIND_LABEL[row.kind]}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      row.hasChanges
                        ? "rounded-full bg-status-warning-soft px-2 py-0.5 text-xs font-semibold text-status-warning"
                        : "rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground"
                    }
                  >
                    {row.hasChanges ? "Unpublished changes" : "Draft"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {canPublish ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busyId === row.id}
                      onClick={() => void publish(row)}
                    >
                      {busyId === row.id ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Publish
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Waiting</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
