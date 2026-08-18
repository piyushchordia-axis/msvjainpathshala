import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast-jp";
import { DragReorderList } from "./DragReorderList";
import { PublishControls } from "./PublishControls";
import type {
  GranthAdminAvailability,
  GranthAdminEntry,
  GranthAdminLibrary,
  GranthLibraryItemOption,
} from "./granth-admin-types";
import { hasUnpublishedChanges } from "./library-admin-types";
import { useConfirm } from "@/components/admin/use-confirm";

const BASE = "/v1/admin/library/granth";

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * v3 §17.11.5 — the granths themselves.
 *
 * Entries are state_admin and above. `can_manage` comes off the API rather than
 * a role check here, so the hidden buttons and the service's 403 cannot
 * disagree about who may act.
 */
export function GranthEntriesPanel() {
  const [entries, setEntries] = useState<GranthAdminEntry[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<GranthAdminEntry | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ entries: GranthAdminEntry[]; can_manage: boolean }>(
        query.trim() ? `${BASE}/entries?q=${encodeURIComponent(query.trim())}` : `${BASE}/entries`,
      );
      setEntries(res.entries);
      setCanManage(res.can_manage);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load granths.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => void reload(), 250);
    return () => clearTimeout(t);
  }, [reload]);

  async function reorder(ids: string[]) {
    setEntries((prev) => ids.map((id) => prev.find((e) => e.id === id)!).filter(Boolean));
    try {
      await apiPost(`${BASE}/entries/reorder`, { ids });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the new order.");
      await reload();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or author…"
            className="pl-8"
          />
        </div>
        {canManage ? (
          <Button type="button" size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            New granth
          </Button>
        ) : null}
      </div>

      {!canManage ? (
        <p className="text-sm text-muted-foreground">
          Granths are managed by state admins. You can see the catalogue here, and set which
          of your own libraries hold each one from the library editor.
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query.trim() ? "No granths match that search." : "No granths listed yet."}
        </p>
      ) : query.trim() || !canManage ? (
        // Reorder is meaningless over a filtered list — dropping a row would
        // write an order for the rows you can see and silently renumber them
        // against the ones you cannot.
        <div className="space-y-2">
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} onOpen={() => setEditing(entry)} />
          ))}
        </div>
      ) : (
        <DragReorderList
          items={entries}
          labelFor={(entry) => entry.draft.title_en}
          onReorder={(ids) => void reorder(ids)}
          renderRow={(entry, handle) => (
            <EntryRow entry={entry} handle={handle} onOpen={() => setEditing(entry)} />
          )}
        />
      )}

      <Dialog
        open={creating || !!editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <EntryEditor
            entry={editing}
            canManage={canManage}
            onClose={() => {
              setCreating(false);
              setEditing(null);
            }}
            onChanged={reload}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EntryRow({
  entry,
  handle,
  onOpen,
}: {
  entry: GranthAdminEntry;
  handle?: React.ReactNode;
  onOpen: () => void;
}) {
  return (
    <Card className="flex items-center gap-3 p-4">
      {handle}
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block font-display text-base text-secondary">
          {entry.draft.title_en}
        </span>
        <span className="block text-sm text-muted-foreground">
          {[entry.draft.author_en, entry.draft.language].filter(Boolean).join(" · ") || "—"}
        </span>
      </button>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
          entry.is_published ? "bg-accent text-primary" : "bg-muted text-muted-foreground"
        }`}
      >
        {entry.is_published ? "Published" : "Draft"}
      </span>
    </Card>
  );
}

function EntryEditor({
  entry,
  canManage,
  onClose,
  onChanged,
}: {
  entry: GranthAdminEntry | null;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const d = entry?.draft;
  const { confirm, confirmDialog } = useConfirm();
  const [titleEn, setTitleEn] = useState(d?.title_en ?? "");
  const [titleHi, setTitleHi] = useState(d?.title_hi ?? "");
  const [authorEn, setAuthorEn] = useState(d?.author_en ?? "");
  const [authorHi, setAuthorHi] = useState(d?.author_hi ?? "");
  const [language, setLanguage] = useState(d?.language ?? "");
  const [descEn, setDescEn] = useState(d?.description_en ?? "");
  const [descHi, setDescHi] = useState(d?.description_hi ?? "");
  const [linkedItemId, setLinkedItemId] = useState<string | null>(d?.linked_item_id ?? null);
  const [busy, setBusy] = useState(false);
  const [availability, setAvailability] = useState<GranthAdminAvailability[]>([]);

  useEffect(() => {
    if (!entry) return;
    void apiGet<{ availability: GranthAdminAvailability[] }>(`${BASE}/entries/${entry.id}`)
      .then((res) => setAvailability(res.availability))
      .catch(() => {
        /* the editor still works without it */
      });
  }, [entry]);

  function body() {
    return {
      title_en: titleEn.trim(),
      title_hi: titleHi.trim() || null,
      author_en: authorEn.trim() || null,
      author_hi: authorHi.trim() || null,
      language: language.trim() || null,
      description_en: descEn.trim() || null,
      description_hi: descHi.trim() || null,
      linked_item_id: linkedItemId,
    };
  }

  async function save() {
    setBusy(true);
    try {
      if (entry) await apiPatch(`${BASE}/entries/${entry.id}`, body());
      else await apiPost(`${BASE}/entries`, body());
      await onChanged();
      toast.success("Draft saved.");
      if (!entry) onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the granth.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!entry) return;
    const ok = await confirm({
      title: `Delete "${entry.draft.title_en}"?`,
      destructive: true,
      confirmLabel: "Delete granth",
      body: (
        <>
          <p>
            This granth disappears from the public directory, including the "available at"
            links on any library that holds it.
          </p>
          <p className="text-muted-foreground">
            Nothing is erased — the record is kept, so a developer can restore it if this was
            a mistake.
          </p>
        </>
      ),
    });
    if (!ok) return;
    try {
      await apiDelete(`${BASE}/entries/${entry.id}`);
      toast.success("Granth deleted.");
      onClose();
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete.");
    }
  }

  return (
    <>
      {confirmDialog}
      <DialogHeader>
        <DialogTitle>{entry ? entry.draft.title_en : "New granth"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-2">
        {entry && canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <PublishControls
              canPublish
              isPublished={entry.is_published}
              hasChanges={hasUnpublishedChanges(entry)}
              onPublish={async () => {
                await apiPost(`${BASE}/entries/${entry.id}/publish`, {});
                await onChanged();
                toast.success("Published.");
              }}
              onUnpublish={async () => {
                await apiPost(`${BASE}/entries/${entry.id}/unpublish`, {});
                await onChanged();
                toast.success("Unpublished.");
              }}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => void remove()}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        ) : null}

        <fieldset disabled={!canManage} className="space-y-3 disabled:opacity-70">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormRow label="Title (EN)">
              <Input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
            </FormRow>
            <FormRow label="Title (HI)">
              <Input
                className="field-devanagari"
                value={titleHi}
                onChange={(e) => setTitleHi(e.target.value)}
              />
            </FormRow>
            <FormRow label="Author (EN)">
              <Input value={authorEn} onChange={(e) => setAuthorEn(e.target.value)} />
            </FormRow>
            <FormRow label="Author (HI)">
              <Input
                className="field-devanagari"
                value={authorHi}
                onChange={(e) => setAuthorHi(e.target.value)}
              />
            </FormRow>
            <FormRow label="Language">
              <Input
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="Prakrit, Sanskrit, Gujarati…"
              />
            </FormRow>
          </div>
          <FormRow label="Description (EN)">
            <Input value={descEn} onChange={(e) => setDescEn(e.target.value)} />
          </FormRow>
          <FormRow label="Description (HI)">
            <Input
              className="field-devanagari"
              value={descHi}
              onChange={(e) => setDescHi(e.target.value)}
            />
          </FormRow>

          <LibraryItemPicker value={linkedItemId} onChange={setLinkedItemId} />
        </fieldset>

        {entry ? (
          <AvailabilityManager
            entryId={entry.id}
            rows={availability}
            onChanged={setAvailability}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Save the granth first, then record which libraries hold it.
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        {canManage ? (
          <Button type="button" disabled={busy} onClick={() => void save()}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Save draft
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}

/** "Read online" target — searches titles and item codes, published first. */
function LibraryItemPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<GranthLibraryItemOption[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      void apiGet<{ items: GranthLibraryItemOption[] }>(
        query.trim()
          ? `${BASE}/library-items?q=${encodeURIComponent(query.trim())}`
          : `${BASE}/library-items`,
      )
        .then((res) => setOptions(res.items))
        .catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const selected = options.find((o) => o.id === value);

  return (
    <div className="space-y-1">
      <span className="text-sm text-muted-foreground">Read online (library item)</span>
      {value ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate">
            {selected ? `${selected.item_code} — ${selected.title_en}` : value}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Clear linked item"
            className="text-muted-foreground hover:text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search library items by title or code…"
      />
      {options.length > 0 ? (
        <Select value={value ?? ""} onValueChange={(v) => onChange(v || null)}>
          <SelectTrigger>
            <SelectValue placeholder="Pick an item" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.item_code} — {o.title_en}
                {o.is_published ? "" : " (draft)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Optional. When set, readers get a “Read online” action on the granth.
      </p>
    </div>
  );
}

/**
 * §17.11.5 — which libraries hold this granth, and on what terms.
 *
 * A city_admin may manage rows for their OWN libraries even though the granth
 * itself is a state record: shelf facts belong to whoever runs the shelf. The
 * picker offers only libraries the server returned, which are already scoped.
 */
function AvailabilityManager({
  entryId,
  rows,
  onChanged,
}: {
  entryId: string;
  rows: GranthAdminAvailability[];
  onChanged: (rows: GranthAdminAvailability[]) => void;
}) {
  const [libraries, setLibraries] = useState<GranthAdminLibrary[]>([]);
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void apiGet<{ libraries: GranthAdminLibrary[] }>(`${BASE}/libraries`)
      .then((res) => setLibraries(res.libraries))
      .catch(() => setLibraries([]));
  }, []);

  async function add() {
    if (!pick) return;
    setBusy(true);
    try {
      const res = await apiPost<{ availability: GranthAdminAvailability[] }>(
        `${BASE}/entries/${entryId}/availability`,
        { library_id: pick, note: note.trim() || null },
      );
      onChanged(res.availability);
      setPick("");
      setNote("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save availability.");
    } finally {
      setBusy(false);
    }
  }

  async function drop(libraryId: string) {
    try {
      const res = await apiDelete<{ availability: GranthAdminAvailability[] }>(
        `${BASE}/entries/${entryId}/availability/${libraryId}`,
      );
      onChanged(res.availability);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove availability.");
    }
  }

  const available = libraries.filter((l) => !rows.some((r) => r.library_id === l.id));

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-sm font-medium text-secondary">Available at</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No libraries recorded yet.</p>
      ) : (
        rows.map((row) => (
          <div key={row.library_id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {row.library_name_en}
              {row.note ? (
                <span className="text-muted-foreground"> — {row.note}</span>
              ) : null}
              {row.is_published ? null : (
                <span className="text-muted-foreground"> (library unpublished)</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => void drop(row.library_id)}
              aria-label={`Remove ${row.library_name_en}`}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))
      )}

      {available.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Add a library" />
            </SelectTrigger>
            <SelectContent>
              {available.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.draft.name_en}
                  {l.city_name ? ` — ${l.city_name}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="reference only, not for issue"
            className="min-w-48 flex-1"
          />
          <Button type="button" size="sm" disabled={!pick || busy} onClick={() => void add()}>
            Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}
