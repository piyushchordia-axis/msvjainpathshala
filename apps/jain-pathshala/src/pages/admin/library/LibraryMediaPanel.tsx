import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast-jp";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  formatBytes,
  type LibraryMediaOrphan,
  type LibraryMediaUsage,
} from "./library-admin-types";

interface Props {
  canPublish: boolean;
}

export function LibraryMediaPanel({ canPublish }: Props) {
  const [usage, setUsage] = useState<LibraryMediaUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<LibraryMediaUsage>("/v1/admin/library/media/usage");
      setUsage(data);
      setSelected(new Set());
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load media usage.");
      setUsage(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function cleanup(keys: string[]) {
    if (!canPublish) return;
    const label =
      keys.length === 0
        ? "Delete all current orphan library files?"
        : `Delete ${keys.length} selected orphan file(s)?`;
    if (!window.confirm(label)) return;
    setBusy(true);
    try {
      const res = await apiPost<{ deleted: number; failed: Array<{ key: string; error: string }> }>(
        "/v1/admin/library/media/orphans/cleanup",
        { keys },
      );
      toast.success(`Deleted ${res.deleted} file(s).`);
      if (res.failed.length) {
        toast.error(`${res.failed.length} file(s) failed to delete.`);
      }
      await reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Cleanup failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading media usage…
      </div>
    );
  }

  if (!usage) {
    return <p className="text-sm text-muted-foreground">No usage data.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-6 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Total size</div>
          <div className="text-lg font-medium">{formatBytes(usage.total_bytes)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Files under library/</div>
          <div className="text-lg font-medium">{usage.file_count}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Orphans</div>
          <div className="text-lg font-medium">{usage.orphans.length}</div>
        </div>
      </div>

      {canPublish && usage.orphans.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || selected.size === 0}
            onClick={() => void cleanup([...selected])}
          >
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Clean selected ({selected.size})
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void cleanup([])}
          >
            Clean all orphans
          </Button>
        </div>
      ) : null}

      {!canPublish ? (
        <p className="text-xs text-muted-foreground">
          Orphan cleanup is limited to super_admin. You can still review unused files.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              {canPublish ? <th className="px-3 py-2 w-10" /> : null}
              <th className="px-3 py-2">Key</th>
              <th className="px-3 py-2">Size</th>
              <th className="px-3 py-2">Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {usage.orphans.length === 0 ? (
              <tr>
                <td
                  colSpan={canPublish ? 4 : 3}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  No orphan library files.
                </td>
              </tr>
            ) : (
              usage.orphans.map((o: LibraryMediaOrphan) => (
                <tr key={o.key} className="border-t border-border">
                  {canPublish ? (
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={selected.has(o.key)}
                        onCheckedChange={() => toggle(o.key)}
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-2 font-mono text-xs">{o.key}</td>
                  <td className="px-3 py-2">{formatBytes(o.size_bytes)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(o.uploaded_at).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
