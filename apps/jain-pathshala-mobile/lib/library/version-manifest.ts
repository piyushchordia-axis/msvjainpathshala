/**
 * Persisted library version manifest snapshot (per auth scope).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type LibraryVersionManifest = {
  sections: Record<string, number>;
  items: Record<string, number>;
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
  return { sections: {}, items: {} };
}
