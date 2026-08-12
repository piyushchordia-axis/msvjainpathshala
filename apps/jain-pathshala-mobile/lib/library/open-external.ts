import { Linking } from "react-native";
import { safeHref } from "@/lib/safe-url";

/**
 * Open a library delivery URL (audio / YouTube) in an external app or browser.
 * Returns "failed" when the URL is unsafe or no handler can open it.
 */
export async function openLibraryExternalUrl(
  url: string | null | undefined,
): Promise<"opened" | "failed"> {
  const safe = safeHref(url ?? null);
  if (!safe) return "failed";
  try {
    await Linking.openURL(safe);
    return "opened";
  } catch {
    return "failed";
  }
}
