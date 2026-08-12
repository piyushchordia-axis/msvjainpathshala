import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast-jp";
import { Button } from "@/components/ui/button";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

type QueueRow = {
  id: string;
  file: File;
  status: "queued" | "uploading" | "done" | "failed";
  error?: string;
};

type BulkResult = {
  filename: string;
  item_code: string | null;
  status: "success" | "failed";
  error?: string;
  item_id?: string;
};

export function LibraryAudioPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [results, setResults] = useState<BulkResult[]>([]);
  const [busy, setBusy] = useState(false);

  function addFiles(files: FileList | File[]) {
    const next: QueueRow[] = [];
    for (const file of Array.from(files)) {
      if (!file.name.toLowerCase().endsWith(".mp3") && file.type !== "audio/mpeg") {
        toast.error(`${file.name} is not an MP3.`);
        continue;
      }
      next.push({ id: `${file.name}-${file.size}-${file.lastModified}`, file, status: "queued" });
    }
    setQueue((q) => [...q, ...next]);
  }

  async function submit() {
    if (queue.length === 0) {
      toast.error("Add MP3 files first.");
      return;
    }
    setBusy(true);
    setResults([]);
    setQueue((q) => q.map((r) => ({ ...r, status: "uploading" as const })));
    try {
      const form = new FormData();
      for (const row of queue) form.append("files", row.file, row.file.name);
      const res = await fetch(`${API_BASE}/v1/admin/library/audio/bulk`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
        body: form,
      });
      if (!res.ok) {
        let message = res.statusText;
        let code = "ERR_HTTP";
        try {
          const j = (await res.json()) as { error?: { code?: string; message?: string } };
          code = j.error?.code ?? code;
          message = j.error?.message ?? message;
        } catch {
          /* ignore */
        }
        throw new ApiError(code, message, res.status);
      }
      const json = (await res.json()) as { data: { results: BulkResult[] } };
      const list = json.data?.results ?? [];
      setResults(list);
      setQueue((q) =>
        q.map((row) => {
          const match = list.find((r) => r.filename === row.file.name);
          if (!match) return { ...row, status: "failed", error: "No result returned." };
          return {
            ...row,
            status: match.status === "success" ? "done" : "failed",
            error: match.error,
          };
        }),
      );
      toast.success("Bulk audio finished — check the match report.");
    } catch (err) {
      setQueue((q) =>
        q.map((r) => ({
          ...r,
          status: "failed",
          error: err instanceof Error ? err.message : "Upload failed",
        })),
      );
      toast.error(err instanceof ApiError ? err.message : "Bulk upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/20 px-4 py-10 text-center"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
      >
        <Upload className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">Drop MP3 files here, or click to browse</p>
        <p className="text-xs text-muted-foreground">
          Filenames should match item_code (e.g. ST-01.mp3)
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="audio/mpeg,.mp3"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {queue.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{queue.length} file(s) queued</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setQueue([])}>
                Clear
              </Button>
              <Button type="button" size="sm" disabled={busy} onClick={() => void submit()}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Upload & match
              </Button>
            </div>
          </div>
          <ul className="divide-y rounded-md border border-border text-sm">
            {queue.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate">{row.file.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {row.status}
                  {row.error ? ` — ${row.error}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {results.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Filename</th>
                <th className="px-3 py-2">item_code</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={`${r.filename}-${i}`} className="border-t border-border">
                  <td className="px-3 py-2">{r.filename}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.item_code ?? "—"}</td>
                  <td className="px-3 py-2">{r.status}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
