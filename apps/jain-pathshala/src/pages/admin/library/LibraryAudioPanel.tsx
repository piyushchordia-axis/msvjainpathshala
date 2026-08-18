import { useMemo, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Link } from "wouter";
import { toast } from "@/components/ui/toast-jp";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  applyOutcome,
  makeRows,
  runBounded,
  setRowProgress,
  type BulkAudioOutcome,
  type BulkAudioRow,
} from "@/lib/bulk-audio-upload";
import { flattenLibraryItems, type LibraryAdminSection } from "./library-admin-types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

/** Three at a time: forty parallel uploads on a centre's line is slower, not faster. */
const CONCURRENCY = 3;

type BulkResult = {
  filename: string;
  item_code: string | null;
  status: "success" | "failed";
  error?: string;
  item_id?: string;
};

/**
 * Upload ONE file and report what the server said about it.
 *
 * XHR rather than fetch because it reports upload progress, which is the whole
 * difference between "forty rows say uploading" and a row you can watch.
 */
function uploadOne(file: File, onProgress: (fraction: number) => void): Promise<BulkAudioOutcome> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append("files", file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/v1/admin/library/audio/bulk`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };

    // A transport failure is NOT a verdict. Reporting it as "failed" tells an
    // admin to re-upload a file that may already be stored.
    xhr.onerror = () => resolve({ kind: "unreachable", error: "Could not reach the server." });
    xhr.ontimeout = () => resolve({ kind: "unreachable", error: "The upload timed out." });
    xhr.onabort = () => resolve({ kind: "unreachable", error: "Upload cancelled." });

    xhr.onload = () => {
      let body: { data?: { results?: BulkResult[] }; error?: { message?: string } } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* handled below */
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        // The server answered and refused. That IS a verdict.
        resolve({
          kind: "rejected",
          itemCode: null,
          error: body.error?.message ?? `Upload failed (${xhr.status}).`,
        });
        return;
      }

      const result = body.data?.results?.[0];
      if (!result) {
        resolve({ kind: "unreachable", error: "The server returned no result for this file." });
        return;
      }
      if (result.status === "success") {
        resolve({
          kind: "stored",
          itemCode: result.item_code,
          itemId: result.item_id ?? null,
        });
        return;
      }
      resolve({
        kind: "rejected",
        itemCode: result.item_code,
        error: result.error ?? "The server rejected this file.",
      });
    };

    xhr.send(form);
  });
}

function StatusCell({ row }: { row: BulkAudioRow }) {
  if (row.status === "uploading") {
    return (
      <span className="flex items-center gap-2">
        <Progress value={Math.round((row.progress ?? 0) * 100)} className="h-1.5 w-24" />
        <span className="text-xs tabular-nums text-muted-foreground">
          {Math.round((row.progress ?? 0) * 100)}%
        </span>
      </span>
    );
  }
  if (row.status === "done") {
    return <span className="text-xs font-medium text-status-success">Matched</span>;
  }
  if (row.status === "failed") {
    return <span className="text-xs font-medium text-destructive">Rejected</span>;
  }
  if (row.status === "unknown") {
    return <span className="text-xs font-medium text-status-warning">Not confirmed</span>;
  }
  return <span className="text-xs text-muted-foreground">Queued</span>;
}

/**
 * The items this upload is for.
 *
 * The tab was disconnected from the library it feeds: it matched filenames
 * against item_code and never said which codes were still waiting. Preparing a
 * batch meant scrolling the Items tab and writing codes down by hand. The tree
 * is already loaded on this page.
 */
function MissingAudioList({ sections }: { sections: LibraryAdminSection[] }) {
  const missing = useMemo(
    () => flattenLibraryItems(sections).filter((i) => !i.draft.audio_url),
    [sections],
  );

  function copyCodes() {
    const text = missing.map((i) => i.item_code).join("\n");
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success(`${missing.length} item_code(s) copied.`))
      .catch(() =>
        toast.error(
          "Could not copy",
          "Your browser blocked clipboard access — select the list and copy it instead.",
        ),
      );
  }

  if (missing.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Every library item has draft audio.</p>
    );
  }

  return (
    <details className="rounded-md border border-border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        {missing.length} item(s) still without audio
      </summary>
      <div className="space-y-2 border-t border-border px-3 py-2">
        <Button type="button" variant="outline" size="sm" onClick={copyCodes}>
          Copy item_codes
        </Button>
        <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
          {missing.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">
                <span className="font-mono text-xs">{item.item_code}</span>
                <span className="ml-2 text-muted-foreground">{item.draft.title_en}</span>
              </span>
              <Link
                href={`/admin/library/items/${item.id}`}
                className="shrink-0 text-xs text-primary hover:underline"
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export function LibraryAudioPanel({ sections }: { sections: LibraryAdminSection[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<BulkAudioRow[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  function addFiles(incoming: FileList | File[]) {
    const accepted: File[] = [];
    for (const file of Array.from(incoming)) {
      if (!file.name.toLowerCase().endsWith(".mp3") && file.type !== "audio/mpeg") {
        toast.error(`${file.name} is not an MP3.`);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return;
    const next = [...files, ...accepted];
    setFiles(next);
    setRows(makeRows(next));
  }

  async function submit() {
    if (files.length === 0) {
      toast.error("Add MP3 files first.");
      return;
    }
    setBusy(true);
    setRows(makeRows(files));
    try {
      await runBounded(files.length, CONCURRENCY, async (index) => {
        const file = files[index];
        if (!file) return;
        setRows((current) => setRowProgress(current, index, 0));
        const outcome = await uploadOne(file, (fraction) => {
          setRows((current) => setRowProgress(current, index, fraction));
        });
        setRows((current) => applyOutcome(current, index, outcome));
      });
      toast.success("Bulk audio finished — check the report below.");
    } finally {
      setBusy(false);
    }
  }

  const unconfirmed = rows.filter((r) => r.status === "unknown").length;

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

      <MissingAudioList sections={sections} />

      {rows.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{rows.length} file(s)</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setFiles([]);
                  setRows([]);
                }}
              >
                Clear
              </Button>
              <Button type="button" size="sm" disabled={busy} onClick={() => void submit()}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Upload &amp; match
              </Button>
            </div>
          </div>

          {unconfirmed > 0 ? (
            <p className="rounded-md border border-border bg-status-warning-soft px-3 py-2 text-xs text-status-warning">
              {unconfirmed} file(s) never got a reply from the server, so we cannot say whether
              they were stored. Open the item to check before uploading again — a repeat upload
              replaces the draft audio, it does not duplicate it.
            </p>
          ) : null}

          <ul className="divide-y rounded-md border border-border text-sm">
            {rows.map((row) => (
              <li key={row.index} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate">
                  {row.filename}
                  {row.itemCode ? (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {row.itemCode}
                    </span>
                  ) : null}
                  {row.error ? (
                    <span className="block text-xs text-muted-foreground">{row.error}</span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {/* item_id came back from the server all along and was discarded,
                      so a match report was a dead end. */}
                  {row.itemId ? (
                    <Link
                      href={`/admin/library/items/${row.itemId}`}
                      className="text-xs text-primary hover:underline"
                    >
                      Open item
                    </Link>
                  ) : null}
                  <StatusCell row={row} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
