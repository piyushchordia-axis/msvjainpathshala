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

type TabId = "sections" | "items" | "audio" | "panchang" | "media";

function tabFromPath(path: string): TabId {
  if (path.includes("/library/items")) return "items";
  if (path.includes("/library/audio")) return "audio";
  if (path.includes("/library/panchang")) return "panchang";
  if (path.includes("/library/media")) return "media";
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
      </Tabs>
    </AdminPageShell>
  );
}
