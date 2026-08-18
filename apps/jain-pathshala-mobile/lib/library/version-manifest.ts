/**
 * Persisted library version manifest snapshot (per auth scope).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type LibraryVersionManifest = {
  sections: Record<string, number>;
  items: Record<string, number>;
  /**
   * §17.7 — the Granth directory versions like everything else. Without
   * these, a corrected address never reaches a device that already holds the
   * directory, and the search index (rebuilt on manifest change) stays stale.
   */
  granth_libraries: Record<string, number>;
  granth_entries: Record<string, number>;
};

export type ManifestScope = "public" | "member";

export function manifestStorageKey(scope: ManifestScope): string {
  return `jp.library.version_manifest.${scope}`;
}

export async function readLocalManifest(
  scope: ManifestScope,
): Promise<LibraryVersionManifest | null> {
  const raw = await AsyncStorage.getItem(manifestStorageKey(scope));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LibraryVersionManifest;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      sections: parsed.sections && typeof parsed.sections === "object" ? parsed.sections : {},
      items: parsed.items && typeof parsed.items === "object" ? parsed.items : {},
      // Absent in snapshots written before the Granth directory shipped —
      // treated as "no granth known yet", which makes the first sync after
      // an upgrade a no-op rather than a spurious full refresh.
      granth_libraries:
        parsed.granth_libraries && typeof parsed.granth_libraries === "object"
          ? parsed.granth_libraries
          : {},
      granth_entries:
        parsed.granth_entries && typeof parsed.granth_entries === "object"
          ? parsed.granth_entries
          : {},
    };
  } catch {
    return null;
  }
}

export async function writeLocalManifest(
  scope: ManifestScope,
  manifest: LibraryVersionManifest,
): Promise<void> {
  await AsyncStorage.setItem(manifestStorageKey(scope), JSON.stringify(manifest));
}

export function emptyManifest(): LibraryVersionManifest {
  return { sections: {}, items: {}, granth_libraries: {}, granth_entries: {} };
}
