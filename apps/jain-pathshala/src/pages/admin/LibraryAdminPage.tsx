import { Redirect, useLocation, useRoute } from "wouter";
import { AdminPageShell, AdminError } from "@/components/admin/AdminPageShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth-context";
import { roleSatisfies } from "@/components/admin/sidebar-nav";
import type { Role } from "@/lib/auth";
import { canPublishLibrary } from "./library/library-admin-types";
import { useLibraryAdminTree } from "./library/useLibraryAdminTree";
import { LibrarySectionsPanel } from "./library/LibrarySectionsPanel";
import { LibraryItemsPanel } from "./library/LibraryItemsPanel";
import { LibraryAudioPanel } from "./library/LibraryAudioPanel";
import { LibraryPanchangPanel } from "./library/LibraryPanchangPanel";
import { LibraryMediaPanel } from "./library/LibraryMediaPanel";
import { LibraryRequestsPanel } from "./library/LibraryRequestsPanel";
import { GranthLibrariesPanel } from "./library/GranthLibrariesPanel";
import { GranthEntriesPanel } from "./library/GranthEntriesPanel";

type TabId =
  | "sections"
  | "items"
  | "audio"
  | "panchang"
  | "media"
  | "requests"
  | "granth-libraries"
  | "granth-entries";

function tabFromPath(path: string): TabId {
  if (path.includes("/library/items")) return "items";
  if (path.includes("/library/audio")) return "audio";
  if (path.includes("/library/panchang")) return "panchang";
  if (path.includes("/library/media")) return "media";
  if (path.includes("/library/requests")) return "requests";
  // Checked before the shorter "/library/granth" prefix would swallow it.
  if (path.includes("/library/granth-entries")) return "granth-entries";
  if (path.includes("/library/granth-libraries")) return "granth-libraries";
  return "sections";
}

function pathForTab(tab: TabId): string {
  switch (tab) {
    case "items":
      return "/admin/library/items";
    case "audio":
      return "/admin/library/audio";
    case "panchang":
      return "/admin/library/panchang";
    case "media":
      return "/admin/library/media";
    case "requests":
      return "/admin/library/requests";
    case "granth-libraries":
      return "/admin/library/granth-libraries";
    case "granth-entries":
      return "/admin/library/granth-entries";
    default:
      return "/admin/library";
  }
}

export default function LibraryAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [location, setLocation] = useLocation();
  const [, itemParams] = useRoute("/admin/library/items/:id");
  const { sections, loading, error, reload } = useLibraryAdminTree();

  if (authLoading) {
    return (
      <AdminPageShell title="Library">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminPageShell>
    );
  }

  const role = (user?.role ?? "guest") as Role;
  if (!roleSatisfies(role, "city_admin")) {
    return <Redirect to="/admin" />;
  }

  const canPublish = canPublishLibrary(user?.role);
  const tab = tabFromPath(location);

  return (
    <AdminPageShell
      title="Library"
      subtitle="Author sections, items, audio, Panchang, and media. Publish is limited to super_admin."
    >
      {error ? <AdminError message={error} /> : null}

      <Tabs
        value={tab}
        onValueChange={(v) => setLocation(pathForTab(v as TabId))}
        className="space-y-4"
      >
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="sections">Sections</TabsTrigger>
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="audio">Bulk audio</TabsTrigger>
          <TabsTrigger value="panchang">Panchang</TabsTrigger>
          <TabsTrigger value="media">Media</TabsTrigger>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="granth-libraries">Granth libraries</TabsTrigger>
          <TabsTrigger value="granth-entries">Granths</TabsTrigger>
        </TabsList>

        <TabsContent value="sections">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading sections…</p>
          ) : (
            <LibrarySectionsPanel
              sections={sections}
              canPublish={canPublish}
              onChanged={reload}
            />
          )}
        </TabsContent>

        <TabsContent value="items">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading items…</p>
          ) : (
            <LibraryItemsPanel
              sections={sections}
              canPublish={canPublish}
              initialItemId={itemParams?.id ?? null}
              onChanged={reload}
            />
          )}
        </TabsContent>

        <TabsContent value="audio">
          <LibraryAudioPanel />
        </TabsContent>

        <TabsContent value="panchang">
          <LibraryPanchangPanel canPublish={canPublish} />
        </TabsContent>

        <TabsContent value="media">
          <LibraryMediaPanel canPublish={canPublish} />
        </TabsContent>

        {/* Reading the queue is city_admin+ (this whole page already is);
            acting on it is state_admin+ and gated by the API's can_act, never
            by the tab merely being visible. */}
        {/* §17.11.5 — city_admin sees only their own city's libraries and
            may read but not write granths. Both come off the API, never off
            a role check here: hiding supplements enforcement, never
            replaces it. */}
        <TabsContent value="granth-libraries">
          <GranthLibrariesPanel />
        </TabsContent>

        <TabsContent value="granth-entries">
          <GranthEntriesPanel />
        </TabsContent>

        <TabsContent value="requests">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading requests…</p>
          ) : (
            <LibraryRequestsPanel sections={sections} />
          )}
        </TabsContent>
      </Tabs>
    </AdminPageShell>
  );
}
