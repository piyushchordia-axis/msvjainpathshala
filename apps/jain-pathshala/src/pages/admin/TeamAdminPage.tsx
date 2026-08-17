/**
 * Admin Team directory — members list/editor, drag-reorder, category settings.
 * Visible to city_admin+ only (nav + page gate). Service layer remains authoritative.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Redirect } from "wouter";
import {
  Loader2,
  Pencil,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  ApiError,
} from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { roleSatisfies } from "@/components/admin/sidebar-nav";
import {
  AdminError,
  AdminPageShell,
  AdminTable,
} from "@/components/admin/AdminPageShell";
import { DragReorderList } from "@/pages/admin/library/DragReorderList";
import { ImpersonateButton } from "@/components/admin/ImpersonateButton";
import { PublishControls } from "@/pages/admin/library/PublishControls";
import { toast } from "@/components/ui/toast-jp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

type ScopeLevel = "national" | "state" | "city" | "centre";
type DisplayStyle = "featured" | "grid" | "list";
type GroupBy = "none" | "centre";

interface TeamCategory {
  id: string;
  key: string;
  name_en: string;
  name_hi: string;
  order: number;
  display_style: DisplayStyle;
  group_by: GroupBy;
  is_lazy_loaded: boolean;
  is_published: boolean;
}

interface TeamMember {
  id: string;
  category_id: string;
  user_id: string | null;
  user: {
    id: string;
    full_name: string;
    role: string;
    photo_url: string | null;
  } | null;
  scope_level: ScopeLevel;
  state_id: string | null;
  city_id: string | null;
  centre_id: string | null;
  honorific: string | null;
  display_name_en: string | null;
  display_name_hi: string | null;
  designation_en: string | null;
  designation_hi: string | null;
  bio_en: string | null;
  bio_hi: string | null;
  photo_override_asset_id: string | null;
  photo_url: string | null;
  associated_since: number | null;
  is_in_memoriam: boolean;
  order: number;
  is_published: boolean;
  published_at: string | null;
  unpublished_by: string | null;
  content_version: number;
}

interface GeoState {
  id: string;
  name: string;
}
interface GeoCity {
  id: string;
  name: string;
  state_id: string;
  state_name?: string;
}
interface CentreOption {
  id: string;
  name: string;
  city_id?: string;
  city_name?: string;
  state_name?: string;
}

function FormRow({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground" style={{ lineHeight: "22px" }}>{hint}</p> : null}
    </div>
  );
}

function displayName(m: TeamMember): string {
  const honorific = m.honorific?.trim();
  const name =
    m.display_name_en?.trim() ||
    m.display_name_hi?.trim() ||
    m.user?.full_name?.trim() ||
    "—";
  return honorific ? `${honorific} ${name}` : name;
}

function isAutoProvisioned(m: TeamMember): boolean {
  return Boolean(m.user_id);
}

async function uploadTeamPhoto(file: File): Promise<{ asset_id: string; url: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("purpose", "team_photo");
  form.append("folder", "team-photos");
  const res = await fetch(`${API_BASE}/v1/uploads`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
    body: form,
  });
  if (!res.ok) {
    let code = "ERR_UPLOAD";
    let message = res.statusText;
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(code, message, res.status);
  }
  const json = (await res.json()) as {
    data: { asset_id?: string; url: string };
  };
  if (!json.data.asset_id) {
    throw new ApiError("ERR_UPLOAD", "Upload did not return an asset id.", 500);
  }
  return { asset_id: json.data.asset_id, url: json.data.url };
}

/** Overrideable bilingual / photo field for auto-provisioned rows. */
function OverrideField({
  label,
  tracking,
  placeholder,
  overridden,
  onToggleOverride,
  children,
}: {
  label: string;
  tracking: boolean;
  placeholder: string;
  overridden: boolean;
  onToggleOverride: (next: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-xs font-medium">{label}</Label>
        {tracking ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onToggleOverride(!overridden)}
          >
            {overridden ? "Use user record" : "Override"}
          </Button>
        ) : null}
      </div>
      {tracking && !overridden ? (
        <p
          className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground"
          style={{ lineHeight: "22px" }}
        >
          Tracks user: <span className="text-foreground">{placeholder || "—"}</span>
          <span className="mt-1 block text-xs">
            Leave override empty to keep following the user record.
          </span>
        </p>
      ) : (
        children
      )}
    </div>
  );
}

export default function TeamAdminPage() {
  const { user } = useAuth();
  const canManage = user ? roleSatisfies(user.role, "city_admin") : false;
  const canEditCategories = user
    ? roleSatisfies(user.role, "state_admin")
    : false;

  const [tab, setTab] = useState("members");
  const [categories, setCategories] = useState<TeamCategory[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterCity, setFilterCity] = useState<string>("all");
  const [filterCentre, setFilterCentre] = useState<string>("all");
  const [filterPublished, setFilterPublished] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  const [states, setStates] = useState<GeoState[]>([]);
  const [cities, setCities] = useState<GeoCity[]>([]);
  const [centres, setCentres] = useState<CentreOption[]>([]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [creating, setCreating] = useState(false);
  const [unpublishTarget, setUnpublishTarget] = useState<TeamMember | null>(null);
  const [busy, setBusy] = useState(false);

  const [reorderCategoryId, setReorderCategoryId] = useState<string>("");

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const visibleCities = useMemo(() => {
    if (user?.role === "city_admin" && user.city_id) {
      return cities.filter((c) => c.id === user.city_id);
    }
    return cities;
  }, [cities, user]);

  const visibleCentres = useMemo(() => {
    let list = centres;
    if (user?.role === "city_admin" && user.city_id) {
      list = list.filter((c) => c.city_id === user.city_id);
    }
    if (filterCity !== "all") {
      list = list.filter((c) => c.city_id === filterCity);
    }
    return list;
  }, [centres, user, filterCity]);

  const categoryById = useMemo(() => {
    const m = new Map<string, TeamCategory>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  const cityNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cities) m.set(c.id, c.name);
    return m;
  }, [cities]);

  const loadMeta = useCallback(async () => {
    const [cats, geo, centreRes] = await Promise.all([
      apiGet<{ items: TeamCategory[] }>("/v1/admin/team/categories"),
      apiGet<{ states?: GeoState[]; cities?: GeoCity[] }>("/v1/admin/geography").catch(() => ({
        states: [] as GeoState[],
        cities: [] as GeoCity[],
      })),
      apiGet<{ items: CentreOption[] }>("/v1/admin/centres").catch(() => ({
        items: [] as CentreOption[],
      })),
    ]);
    setCategories(cats.items ?? []);
    setStates(geo.states ?? []);
    setCities(geo.cities ?? []);
    setCentres(centreRes.items ?? []);
    setReorderCategoryId((prev) => prev || cats.items?.[0]?.id || "");
  }, []);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (filterCategory !== "all") params.set("category_id", filterCategory);
      if (filterCity !== "all") params.set("city_id", filterCity);
      if (filterCentre !== "all") params.set("centre_id", filterCentre);
      if (filterPublished !== "all") params.set("is_published", filterPublished);
      if (searchDebounced) params.set("q", searchDebounced);
      const res = await apiGet<{ items: TeamMember[] }>(
        `/v1/admin/team/members?${params.toString()}`,
      );
      setMembers(res.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load Team members.");
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [filterCategory, filterCity, filterCentre, filterPublished, searchDebounced]);

  useEffect(() => {
    if (!canManage) return;
    void loadMeta().catch((err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not load Team metadata.");
    });
  }, [canManage, loadMeta]);

  useEffect(() => {
    if (!canManage) return;
    void loadMembers();
  }, [canManage, loadMembers]);

  if (!user || !canManage) {
    return <Redirect to="/admin" />;
  }

  async function openCreate() {
    setCreating(true);
    setEditing(null);
    setEditorOpen(true);
  }

  async function openEdit(m: TeamMember) {
    setCreating(false);
    setBusy(true);
    try {
      const res = await apiGet<{ member: TeamMember }>(`/v1/admin/team/members/${m.id}`);
      setEditing(res.member);
      setEditorOpen(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load member.");
    } finally {
      setBusy(false);
    }
  }

  async function publishMember(m: TeamMember) {
    setBusy(true);
    try {
      await apiPost(`/v1/admin/team/members/${m.id}/publish`, {});
      toast.success("Published.");
      await loadMembers();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Publish failed.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmUnpublish() {
    if (!unpublishTarget) return;
    setBusy(true);
    try {
      await apiPost(`/v1/admin/team/members/${unpublishTarget.id}/unpublish`, {});
      toast.success("Unpublished.");
      setUnpublishTarget(null);
      await loadMembers();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Unpublish failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteMember(m: TeamMember) {
    if (!window.confirm(`Remove “${displayName(m)}” from the Team directory?`)) return;
    setBusy(true);
    try {
      await apiDelete(`/v1/admin/team/members/${m.id}`);
      toast.success("Removed.");
      await loadMembers();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove member.");
    } finally {
      setBusy(false);
    }
  }

  async function reorder(ids: string[]) {
    try {
      await apiPost("/v1/admin/team/members/reorder", { ids });
      toast.success("Order saved.");
      await loadMembers();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not reorder.");
    }
  }

  const reorderItems = members
    .filter((m) => m.category_id === reorderCategoryId)
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  return (
    <AdminPageShell
      title="Team"
      subtitle="Public Team directory — Core Team, Sanchalaks, Gurujis & Didis."
      actions={
        <Button type="button" onClick={() => void openCreate()} disabled={busy}>
          <Plus className="mr-1 h-4 w-4" />
          Add manual member
        </Button>
      }
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="reorder">Reorder</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-6 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative lg:col-span-2">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search by name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filterCity}
              onValueChange={(v) => {
                setFilterCity(v);
                setFilterCentre("all");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="City" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cities</SelectItem>
                {visibleCities.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterCentre} onValueChange={setFilterCentre}>
              <SelectTrigger>
                <SelectValue placeholder="Centre" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All centres</SelectItem>
                {visibleCentres.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterPublished} onValueChange={setFilterPublished}>
              <SelectTrigger>
                <SelectValue placeholder="Publish state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All states</SelectItem>
                <SelectItem value="true">Published</SelectItem>
                <SelectItem value="false">Unpublished</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error ? <AdminError message={error} /> : null}

          <AdminTable
            columns={["Member", "Category", "Scope", "Source", "Status", ""]}
            loading={loading}
            empty="No Team members match these filters."
            colSpan={6}
          >
            {members.map((m) => {
              const cat = categoryById.get(m.category_id);
              return (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
                        {m.photo_url ? (
                          <img
                            src={m.photo_url}
                            alt=""
                            className="h-full w-full object-cover object-top"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-saffron text-xs text-cream">
                            —
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div
                          className="truncate font-medium text-foreground"
                          style={{ lineHeight: "22px" }}
                        >
                          {displayName(m)}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.designation_en || m.designation_hi || (m.user ? `Role: ${m.user.role}` : "—")}
                          {m.city_id ? ` · ${cityNameById.get(m.city_id) ?? ""}` : ""}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">{cat?.name_en ?? "—"}</td>
                  <td className="px-4 py-3 text-sm capitalize">{m.scope_level}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        isAutoProvisioned(m)
                          ? "bg-muted text-muted-foreground"
                          : "bg-accent text-accent-foreground"
                      }`}
                    >
                      {isAutoProvisioned(m) ? "Auto" : "Manual"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {m.is_published ? (
                      <span className="text-status-success">Published</span>
                    ) : (
                      <span className="text-muted-foreground">Draft</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {/* Renders only for super_admin; linked-user rows only (SUP-API-03). */}
                      <ImpersonateButton userId={m.user_id} name={displayName(m)} role={m.user?.role} />
                      <PublishControls
                        canPublish
                        isPublished={m.is_published}
                        busy={busy}
                        onPublish={() => void publishMember(m)}
                        onUnpublish={() => {
                          if (isAutoProvisioned(m)) setUnpublishTarget(m);
                          else void (async () => {
                            setBusy(true);
                            try {
                              await apiPost(`/v1/admin/team/members/${m.id}/unpublish`, {});
                              toast.success("Unpublished.");
                              await loadMembers();
                            } catch (err) {
                              toast.error(err instanceof ApiError ? err.message : "Unpublish failed.");
                            } finally {
                              setBusy(false);
                            }
                          })();
                        }}
                      />
                      <Button type="button" variant="ghost" size="sm" onClick={() => void openEdit(m)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => void deleteMember(m)}
                      >
                        Remove
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </AdminTable>
        </TabsContent>

        <TabsContent value="reorder" className="mt-6 space-y-4">
          <FormRow label="Category">
            <Select value={reorderCategoryId} onValueChange={setReorderCategoryId}>
              <SelectTrigger className="max-w-sm">
                <SelectValue placeholder="Pick a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          <p className="text-sm text-muted-foreground" style={{ lineHeight: "22px" }}>
            Drag to set display order within this category. Changes save immediately.
          </p>
          {reorderItems.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">No members in this category.</Card>
          ) : (
            <DragReorderList
              items={reorderItems}
              onReorder={(ids) => void reorder(ids)}
              renderRow={(item, handle) => (
                <Card className="flex items-center gap-3 p-3">
                  {handle}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium" style={{ lineHeight: "22px" }}>
                      {displayName(item)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {isAutoProvisioned(item) ? "Auto" : "Manual"}
                      {item.is_published ? " · Published" : " · Draft"}
                    </div>
                  </div>
                </Card>
              )}
            />
          )}
        </TabsContent>

        <TabsContent value="categories" className="mt-6">
          <CategorySettingsPanel
            categories={categories}
            canEdit={canEditCategories}
            onSaved={async () => {
              await loadMeta();
            }}
          />
        </TabsContent>
      </Tabs>

      <MemberEditorDialog
        open={editorOpen}
        onOpenChange={(o) => {
          setEditorOpen(o);
          if (!o) {
            setEditing(null);
            setCreating(false);
          }
        }}
        creating={creating}
        member={editing}
        categories={categories}
        states={states}
        cities={visibleCities}
        centres={
          user.role === "city_admin" && user.city_id
            ? centres.filter((c) => c.city_id === user.city_id)
            : centres
        }
        defaultCityId={user.role === "city_admin" ? user.city_id ?? null : null}
        onSaved={async () => {
          setEditorOpen(false);
          setEditing(null);
          setCreating(false);
          await loadMembers();
        }}
      />

      <AlertDialog
        open={Boolean(unpublishTarget)}
        onOpenChange={(o) => {
          if (!o) setUnpublishTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpublish this auto-provisioned card?</AlertDialogTitle>
            <AlertDialogDescription style={{ lineHeight: "22px" }}>
              This decision is sticky. If the linked user is deactivated and later reactivated,
              their Team card will not be republished automatically — you would need to publish
              it again yourself.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void confirmUnpublish()}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Unpublish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminPageShell>
  );
}

function CategorySettingsPanel({
  categories,
  canEdit,
  onSaved,
}: {
  categories: TeamCategory[];
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, TeamCategory>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    const next: Record<string, TeamCategory> = {};
    for (const c of categories) next[c.id] = { ...c };
    setDrafts(next);
  }, [categories]);

  if (!canEdit) {
    return (
      <Card className="p-6 text-sm text-muted-foreground" style={{ lineHeight: "22px" }}>
        Category settings (order, display style, grouping) can be edited by state and super
        admins. You can still manage members in your city.
      </Card>
    );
  }

  async function save(id: string) {
    const d = drafts[id];
    if (!d) return;
    setSavingId(id);
    try {
      await apiPatch(`/v1/admin/team/categories/${id}`, {
        order: d.order,
        display_style: d.display_style,
        group_by: d.group_by,
        is_lazy_loaded: d.is_lazy_loaded,
        is_published: d.is_published,
        name_en: d.name_en,
        name_hi: d.name_hi,
      });
      toast.success("Category saved.");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save category.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" style={{ lineHeight: "22px" }}>
        Categories are seeded — read and update only. Do not hardcode category keys in the public
        UI; render from these settings.
      </p>
      {categories.map((c) => {
        const d = drafts[c.id] ?? c;
        return (
          <Card key={c.id} className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="font-display text-lg text-secondary">{c.name_en}</div>
                <div className="text-xs text-muted-foreground">key: {c.key}</div>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={savingId === c.id}
                onClick={() => void save(c.id)}
              >
                {savingId === c.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Save
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <FormRow label="Name (EN)">
                <Input
                  value={d.name_en}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [c.id]: { ...d, name_en: e.target.value } }))
                  }
                />
              </FormRow>
              <FormRow label="Name (HI)">
                <Input
                  value={d.name_hi}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [c.id]: { ...d, name_hi: e.target.value } }))
                  }
                  style={{ lineHeight: "22px" }}
                />
              </FormRow>
              <FormRow label="Order">
                <Input
                  type="number"
                  value={d.order}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [c.id]: { ...d, order: Number(e.target.value) || 0 },
                    }))
                  }
                />
              </FormRow>
              <FormRow label="Display style">
                <Select
                  value={d.display_style}
                  onValueChange={(v) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [c.id]: { ...d, display_style: v as DisplayStyle },
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="grid">Grid</SelectItem>
                    <SelectItem value="list">List</SelectItem>
                    <SelectItem value="featured">Featured (falls back to grid)</SelectItem>
                  </SelectContent>
                </Select>
              </FormRow>
              <FormRow label="Group by">
                <Select
                  value={d.group_by}
                  onValueChange={(v) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [c.id]: { ...d, group_by: v as GroupBy },
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="centre">Centre</SelectItem>
                  </SelectContent>
                </Select>
              </FormRow>
              <FormRow label="Flags">
                <div className="flex flex-col gap-2 pt-1 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={d.is_lazy_loaded}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [c.id]: { ...d, is_lazy_loaded: e.target.checked },
                        }))
                      }
                    />
                    Lazy-loaded (centre pages)
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={d.is_published}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [c.id]: { ...d, is_published: e.target.checked },
                        }))
                      }
                    />
                    Published
                  </label>
                </div>
              </FormRow>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

type EditorForm = {
  category_id: string;
  scope_level: ScopeLevel;
  state_id: string;
  city_id: string;
  centre_id: string;
  honorific: string;
  display_name_en: string;
  display_name_hi: string;
  designation_en: string;
  designation_hi: string;
  bio_en: string;
  bio_hi: string;
  photo_override_asset_id: string | null;
  photo_preview: string | null;
  associated_since: string;
  is_in_memoriam: boolean;
  overrideName: boolean;
  overrideDesignation: boolean;
  overridePhoto: boolean;
  overrideBio: boolean;
};

function emptyManualForm(
  categories: TeamCategory[],
  defaultCityId: string | null,
): EditorForm {
  return {
    category_id: categories[0]?.id ?? "",
    scope_level: defaultCityId ? "city" : "national",
    state_id: "",
    city_id: defaultCityId ?? "",
    centre_id: "",
    honorific: "",
    display_name_en: "",
    display_name_hi: "",
    designation_en: "",
    designation_hi: "",
    bio_en: "",
    bio_hi: "",
    photo_override_asset_id: null,
    photo_preview: null,
    associated_since: "",
    is_in_memoriam: false,
    overrideName: true,
    overrideDesignation: true,
    overridePhoto: true,
    overrideBio: true,
  };
}

function formFromMember(m: TeamMember): EditorForm {
  const auto = Boolean(m.user_id);
  return {
    category_id: m.category_id,
    scope_level: m.scope_level,
    state_id: m.state_id ?? "",
    city_id: m.city_id ?? "",
    centre_id: m.centre_id ?? "",
    honorific: m.honorific ?? "",
    display_name_en: m.display_name_en ?? "",
    display_name_hi: m.display_name_hi ?? "",
    designation_en: m.designation_en ?? "",
    designation_hi: m.designation_hi ?? "",
    bio_en: m.bio_en ?? "",
    bio_hi: m.bio_hi ?? "",
    photo_override_asset_id: m.photo_override_asset_id,
    photo_preview: m.photo_url,
    associated_since: m.associated_since != null ? String(m.associated_since) : "",
    is_in_memoriam: m.is_in_memoriam,
    overrideName: !auto || Boolean(m.display_name_en || m.display_name_hi),
    overrideDesignation: !auto || Boolean(m.designation_en || m.designation_hi),
    overridePhoto: !auto || Boolean(m.photo_override_asset_id),
    overrideBio: !auto || Boolean(m.bio_en || m.bio_hi),
  };
}

function MemberEditorDialog({
  open,
  onOpenChange,
  creating,
  member,
  categories,
  states,
  cities,
  centres,
  defaultCityId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  creating: boolean;
  member: TeamMember | null;
  categories: TeamCategory[];
  states: GeoState[];
  cities: GeoCity[];
  centres: CentreOption[];
  defaultCityId: string | null;
  onSaved: () => Promise<void>;
}) {
  const auto = Boolean(member?.user_id) && !creating;
  const [form, setForm] = useState<EditorForm>(() => emptyManualForm(categories, defaultCityId));
  const [lang, setLang] = useState<"en" | "hi">("en");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (creating || !member) setForm(emptyManualForm(categories, defaultCityId));
    else setForm(formFromMember(member));
    setLang("en");
  }, [open, creating, member, categories, defaultCityId]);

  const scopedCities = useMemo(() => {
    if (!form.state_id) return cities;
    return cities.filter((c) => c.state_id === form.state_id);
  }, [cities, form.state_id]);

  const scopedCentres = useMemo(() => {
    if (form.city_id) return centres.filter((c) => c.city_id === form.city_id);
    if (form.state_id) {
      const cityIds = new Set(cities.filter((c) => c.state_id === form.state_id).map((c) => c.id));
      return centres.filter((c) => c.city_id && cityIds.has(c.city_id));
    }
    return centres;
  }, [centres, cities, form.city_id, form.state_id]);

  function patch<K extends keyof EditorForm>(key: K, value: EditorForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onPhotoSelected(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadTeamPhoto(file);
      setForm((f) => ({
        ...f,
        photo_override_asset_id: uploaded.asset_id,
        photo_preview: uploaded.url,
        overridePhoto: true,
      }));
      toast.success("Photo uploaded.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Photo upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        category_id: form.category_id,
        scope_level: form.scope_level,
        state_id: form.scope_level === "national" ? null : form.state_id || null,
        city_id:
          form.scope_level === "national" || form.scope_level === "state"
            ? null
            : form.city_id || null,
        centre_id: form.scope_level === "centre" ? form.centre_id || null : null,
        honorific: form.honorific.trim() || null,
        associated_since: form.associated_since ? Number(form.associated_since) : null,
        is_in_memoriam: form.is_in_memoriam,
      };

      if (auto) {
        body.display_name_en = form.overrideName ? form.display_name_en.trim() || null : null;
        body.display_name_hi = form.overrideName ? form.display_name_hi.trim() || null : null;
        body.designation_en = form.overrideDesignation
          ? form.designation_en.trim() || null
          : null;
        body.designation_hi = form.overrideDesignation
          ? form.designation_hi.trim() || null
          : null;
        body.bio_en = form.overrideBio ? form.bio_en.trim() || null : null;
        body.bio_hi = form.overrideBio ? form.bio_hi.trim() || null : null;
        body.photo_override_asset_id = form.overridePhoto
          ? form.photo_override_asset_id
          : null;
      } else {
        body.user_id = null;
        body.display_name_en = form.display_name_en.trim();
        body.display_name_hi = form.display_name_hi.trim() || null;
        body.designation_en = form.designation_en.trim() || null;
        body.designation_hi = form.designation_hi.trim() || null;
        body.bio_en = form.bio_en.trim() || null;
        body.bio_hi = form.bio_hi.trim() || null;
        body.photo_override_asset_id = form.photo_override_asset_id;
      }

      if (creating) {
        await apiPost("/v1/admin/team/members", body);
        toast.success("Member created.");
      } else if (member) {
        await apiPatch(`/v1/admin/team/members/${member.id}`, body);
        toast.success("Member saved.");
      }
      await onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save member.");
    } finally {
      setSaving(false);
    }
  }

  const userPlaceholderName = member?.user?.full_name ?? "—";
  const userPlaceholderPhoto = member?.user?.photo_url;
  const userPlaceholderDesignation = member?.user
    ? `From role: ${member.user.role}`
    : "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {creating ? "Add manual Team member" : auto ? "Edit Team member (auto)" : "Edit Team member"}
          </DialogTitle>
        </DialogHeader>

        {auto ? (
          <p className="text-sm text-muted-foreground" style={{ lineHeight: "22px" }}>
            Linked to <strong className="text-foreground">{member?.user?.full_name}</strong> (
            {member?.user?.role}). Empty override fields track the user record.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground" style={{ lineHeight: "22px" }}>
            Manual / trustee card — not linked to a login. Requires an English display name.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormRow label="Category">
            <Select value={form.category_id} onValueChange={(v) => patch("category_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Scope">
            <Select
              value={form.scope_level}
              onValueChange={(v) => patch("scope_level", v as ScopeLevel)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="national">National</SelectItem>
                <SelectItem value="state">State</SelectItem>
                <SelectItem value="city">City</SelectItem>
                <SelectItem value="centre">Centre</SelectItem>
              </SelectContent>
            </Select>
          </FormRow>
        </div>

        {form.scope_level !== "national" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow label="State">
              <Select
                value={form.state_id || undefined}
                onValueChange={(v) => {
                  setForm((f) => ({ ...f, state_id: v, city_id: "", centre_id: "" }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="State" />
                </SelectTrigger>
                <SelectContent>
                  {states.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>
            {form.scope_level === "city" || form.scope_level === "centre" ? (
              <FormRow label="City">
                <Select
                  value={form.city_id || undefined}
                  onValueChange={(v) => {
                    setForm((f) => ({ ...f, city_id: v, centre_id: "" }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="City" />
                  </SelectTrigger>
                  <SelectContent>
                    {scopedCities.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormRow>
            ) : null}
            {form.scope_level === "centre" ? (
              <FormRow label="Centre">
                <Select
                  value={form.centre_id || undefined}
                  onValueChange={(v) => patch("centre_id", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Centre" />
                  </SelectTrigger>
                  <SelectContent>
                    {scopedCentres.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormRow>
            ) : null}
          </div>
        ) : null}

        <FormRow label="Honorific">
          <Input
            value={form.honorific}
            onChange={(e) => patch("honorific", e.target.value)}
            placeholder="Shri / Smt. / …"
          />
        </FormRow>

        <Tabs value={lang} onValueChange={(v) => setLang(v as "en" | "hi")}>
          <TabsList>
            <TabsTrigger value="en">English</TabsTrigger>
            <TabsTrigger value="hi">हिंदी</TabsTrigger>
          </TabsList>
          <TabsContent value="en" className="mt-3 space-y-3">
            <OverrideField
              label="Display name (EN)"
              tracking={auto}
              placeholder={userPlaceholderName}
              overridden={form.overrideName}
              onToggleOverride={(next) => {
                patch("overrideName", next);
                if (!next) {
                  patch("display_name_en", "");
                  patch("display_name_hi", "");
                }
              }}
            >
              <Input
                value={form.display_name_en}
                onChange={(e) => patch("display_name_en", e.target.value)}
                placeholder={auto ? "Override English name (empty = track user)" : "Required"}
              />
            </OverrideField>
            <OverrideField
              label="Designation (EN)"
              tracking={auto}
              placeholder={userPlaceholderDesignation}
              overridden={form.overrideDesignation}
              onToggleOverride={(next) => {
                patch("overrideDesignation", next);
                if (!next) {
                  patch("designation_en", "");
                  patch("designation_hi", "");
                }
              }}
            >
              <Input
                value={form.designation_en}
                onChange={(e) => patch("designation_en", e.target.value)}
                placeholder={auto ? "Override designation (empty = from role)" : "Designation"}
              />
            </OverrideField>
            <OverrideField
              label="Bio (EN)"
              tracking={auto}
              placeholder="No user bio — optional override"
              overridden={form.overrideBio}
              onToggleOverride={(next) => {
                patch("overrideBio", next);
                if (!next) {
                  patch("bio_en", "");
                  patch("bio_hi", "");
                }
              }}
            >
              <Textarea
                value={form.bio_en}
                onChange={(e) => patch("bio_en", e.target.value)}
                rows={3}
              />
            </OverrideField>
          </TabsContent>
          <TabsContent value="hi" className="mt-3 space-y-3">
            <OverrideField
              label="Display name (HI)"
              tracking={auto}
              placeholder={userPlaceholderName}
              overridden={form.overrideName}
              onToggleOverride={(next) => patch("overrideName", next)}
            >
              <Input
                value={form.display_name_hi}
                onChange={(e) => patch("display_name_hi", e.target.value)}
                style={{ lineHeight: "22px" }}
              />
            </OverrideField>
            <OverrideField
              label="Designation (HI)"
              tracking={auto}
              placeholder={userPlaceholderDesignation}
              overridden={form.overrideDesignation}
              onToggleOverride={(next) => patch("overrideDesignation", next)}
            >
              <Input
                value={form.designation_hi}
                onChange={(e) => patch("designation_hi", e.target.value)}
                style={{ lineHeight: "22px" }}
              />
            </OverrideField>
            <OverrideField
              label="Bio (HI)"
              tracking={auto}
              placeholder="—"
              overridden={form.overrideBio}
              onToggleOverride={(next) => patch("overrideBio", next)}
            >
              <Textarea
                value={form.bio_hi}
                onChange={(e) => patch("bio_hi", e.target.value)}
                rows={3}
                style={{ lineHeight: "22px" }}
              />
            </OverrideField>
          </TabsContent>
        </Tabs>

        <OverrideField
          label="Photo"
          tracking={auto}
          placeholder={userPlaceholderPhoto ? "User profile photo" : "No user photo"}
          overridden={form.overridePhoto}
          onToggleOverride={(next) => {
            patch("overridePhoto", next);
            if (!next) {
              patch("photo_override_asset_id", null);
              patch("photo_preview", userPlaceholderPhoto ?? null);
            }
          }}
        >
          <div className="flex flex-wrap items-center gap-4">
            <div className="h-20 w-20 overflow-hidden rounded-md bg-muted">
              {form.photo_preview ? (
                <img
                  src={form.photo_preview}
                  alt=""
                  className="h-full w-full object-cover object-top"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-saffron text-cream text-xs">
                  None
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary">
                <Upload className="h-4 w-4" />
                {uploading ? "Uploading…" : "Upload photo"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => void onPhotoSelected(e.target.files?.[0] ?? null)}
                />
              </Label>
              {form.photo_override_asset_id ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    patch("photo_override_asset_id", null);
                    patch("photo_preview", null);
                  }}
                >
                  Clear photo
                </Button>
              ) : null}
            </div>
          </div>
        </OverrideField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormRow label="Associated since (year)">
            <Input
              type="number"
              value={form.associated_since}
              onChange={(e) => patch("associated_since", e.target.value)}
              placeholder="e.g. 2018"
            />
          </FormRow>
          <FormRow label="In memoriam">
            <label className="flex items-center gap-2 pt-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_in_memoriam}
                onChange={(e) => patch("is_in_memoriam", e.target.checked)}
              />
              Show as in memoriam
            </label>
          </FormRow>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={saving || uploading} onClick={() => void save()}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
