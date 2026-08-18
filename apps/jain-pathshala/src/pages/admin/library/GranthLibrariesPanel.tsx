import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast-jp";
import { DragReorderList } from "./DragReorderList";
import { PublishControls } from "./PublishControls";
import type { GranthAdminCity, GranthAdminLibrary } from "./granth-admin-types";
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
 * v3 §17.11.5 — the physical libraries.
 *
 * A city_admin sees only their own city here, and the city picker only offers
 * cities they may file under. Both lists come from the server rather than from
 * a role check in the browser, so the hiding follows the same rule the writes
 * enforce — it supplements service enforcement, never replaces it.
 */
export function GranthLibrariesPanel() {
  const [libraries, setLibraries] = useState<GranthAdminLibrary[]>([]);
  const [cities, setCities] = useState<GranthAdminCity[]>([]);
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<GranthAdminLibrary | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [libs, cityList] = await Promise.all([
        apiGet<{ libraries: GranthAdminLibrary[] }>(
          cityFilter === "all" ? `${BASE}/libraries` : `${BASE}/libraries?city_id=${cityFilter}`,
        ),
        apiGet<{ cities: GranthAdminCity[] }>(`${BASE}/cities`),
      ]);
      setLibraries(libs.libraries);
      setCities(cityList.cities);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load granth libraries.");
    } finally {
      setLoading(false);
    }
  }, [cityFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function reorder(ids: string[]) {
    // Optimistic: the drag already moved the row under the cursor, and snapping
    // it back on every save would make the list feel broken.
    setLibraries((prev) => ids.map((id) => prev.find((l) => l.id === id)!).filter(Boolean));
    try {
      await apiPost(`${BASE}/libraries/reorder`, { ids });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the new order.");
      await reload();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={cityFilter} onValueChange={setCityFilter}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All my cities</SelectItem>
            {cities.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          New library
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : libraries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No granth libraries in your scope yet. Create one to start the directory.
        </p>
      ) : (
        <DragReorderList
          items={libraries}
          labelFor={(lib) => lib.draft.name_en}
          onReorder={(ids) => void reorder(ids)}
          renderRow={(lib, handle) => (
            <Card className="flex items-center gap-3 p-4">
              {handle}
              <button
                type="button"
                onClick={() => setEditing(lib)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block font-display text-base text-secondary">
                  {lib.draft.name_en}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {lib.city_name ?? "—"} · {lib.draft.address_en}
                </span>
              </button>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                  lib.is_published
                    ? "bg-accent text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {lib.is_published ? "Published" : "Draft"}
              </span>
            </Card>
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
          <LibraryEditor
            library={editing}
            cities={cities}
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

function LibraryEditor({
  library,
  cities,
  onClose,
  onChanged,
}: {
  library: GranthAdminLibrary | null;
  cities: GranthAdminCity[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const d = library?.draft;
  const { confirm, confirmDialog } = useConfirm();
  const [nameEn, setNameEn] = useState(d?.name_en ?? "");
  const [nameHi, setNameHi] = useState(d?.name_hi ?? "");
  const [addressEn, setAddressEn] = useState(d?.address_en ?? "");
  const [addressHi, setAddressHi] = useState(d?.address_hi ?? "");
  const [cityId, setCityId] = useState(d?.city_id ?? cities[0]?.id ?? "");
  const [contactName, setContactName] = useState(d?.contact_name ?? "");
  const [contactPhone, setContactPhone] = useState(d?.contact_phone ?? "");
  const [hasWhatsapp, setHasWhatsapp] = useState(d?.has_whatsapp ?? false);
  const [timingsEn, setTimingsEn] = useState(d?.timings_en ?? "");
  const [timingsHi, setTimingsHi] = useState(d?.timings_hi ?? "");
  const [lat, setLat] = useState(d?.lat != null ? String(d.lat) : "");
  const [lng, setLng] = useState(d?.lng != null ? String(d.lng) : "");
  const [noteEn, setNoteEn] = useState(d?.note_en ?? "");
  const [noteHi, setNoteHi] = useState(d?.note_hi ?? "");
  const [busy, setBusy] = useState(false);

  function body() {
    const num = (v: string) => {
      const t = v.trim();
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    };
    return {
      name_en: nameEn.trim(),
      name_hi: nameHi.trim() || null,
      address_en: addressEn.trim(),
      address_hi: addressHi.trim() || null,
      city_id: cityId,
      contact_name: contactName.trim() || null,
      contact_phone: contactPhone.trim() || null,
      has_whatsapp: hasWhatsapp,
      timings_en: timingsEn.trim() || null,
      timings_hi: timingsHi.trim() || null,
      lat: num(lat),
      lng: num(lng),
      note_en: noteEn.trim() || null,
      note_hi: noteHi.trim() || null,
    };
  }

  async function save() {
    setBusy(true);
    try {
      if (library) await apiPatch(`${BASE}/libraries/${library.id}`, body());
      else await apiPost(`${BASE}/libraries`, body());
      await onChanged();
      toast.success("Draft saved.");
      if (!library) onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the library.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!library) return;
    const ok = await confirm({
      title: `Delete "${library.draft.name_en}"?`,
      destructive: true,
      confirmLabel: "Delete library",
      body: (
        <>
          <p>
            This physical library disappears from the public directory, and granths held here
            stop showing it under "available at".
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
      await apiDelete(`${BASE}/libraries/${library.id}`);
      toast.success("Library deleted.");
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
        <DialogTitle>{library ? library.draft.name_en : "New granth library"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-2">
        {library ? (
          <div className="flex flex-wrap items-center gap-2">
            <PublishControls
              canPublish
              isPublished={library.is_published}
              hasChanges={hasUnpublishedChanges(library)}
              onPublish={async () => {
                await apiPost(`${BASE}/libraries/${library.id}/publish`, {});
                await onChanged();
                toast.success("Published.");
              }}
              onUnpublish={async () => {
                await apiPost(`${BASE}/libraries/${library.id}/unpublish`, {});
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

        <FormRow label="City">
          <Select value={cityId} onValueChange={setCityId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a city" />
            </SelectTrigger>
            <SelectContent>
              {/* Only cities this admin may file under — the server decides
                  which those are, and refuses the rest regardless. */}
              {cities.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormRow>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormRow label="Name (EN)">
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </FormRow>
          <FormRow label="Name (HI)">
            <Input
              className="field-devanagari"
              value={nameHi}
              onChange={(e) => setNameHi(e.target.value)}
            />
          </FormRow>
          <FormRow label="Address (EN)">
            <Input value={addressEn} onChange={(e) => setAddressEn(e.target.value)} />
          </FormRow>
          <FormRow label="Address (HI)">
            <Input
              className="field-devanagari"
              value={addressHi}
              onChange={(e) => setAddressHi(e.target.value)}
            />
          </FormRow>
          <FormRow label="Timings (EN)">
            <Input
              value={timingsEn}
              onChange={(e) => setTimingsEn(e.target.value)}
              placeholder="9am - 6pm, closed Sunday"
            />
          </FormRow>
          <FormRow label="Timings (HI)">
            <Input
              className="field-devanagari"
              value={timingsHi}
              onChange={(e) => setTimingsHi(e.target.value)}
            />
          </FormRow>
          <FormRow label="Note (EN)">
            <Input value={noteEn} onChange={(e) => setNoteEn(e.target.value)} />
          </FormRow>
          <FormRow label="Note (HI)">
            <Input
              className="field-devanagari"
              value={noteHi}
              onChange={(e) => setNoteHi(e.target.value)}
            />
          </FormRow>
          <FormRow label="Contact name">
            <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </FormRow>
          <FormRow label="Contact phone">
            <Input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+91…"
            />
          </FormRow>
        </div>

        <div className="flex items-center gap-3">
          <Switch checked={hasWhatsapp} onCheckedChange={setHasWhatsapp} id="granth-whatsapp" />
          <label htmlFor="granth-whatsapp" className="text-sm">
            Reachable on WhatsApp
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          WhatsApp needs the contact number with its country code — without one the link
          would open a chat in whichever country the reader is in.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormRow label="Latitude (optional)">
            <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="22.7196" />
          </FormRow>
          <FormRow label="Longitude (optional)">
            <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="75.8577" />
          </FormRow>
        </div>
        <p className="text-xs text-muted-foreground">
          Give both or neither. With coordinates the maps link is exact; without them it
          searches the address.
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          Save draft
        </Button>
      </DialogFooter>
    </>
  );
}
