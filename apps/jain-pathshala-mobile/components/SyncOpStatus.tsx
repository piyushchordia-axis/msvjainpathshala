/**
 * Six offline sync UI states — design tokens only, no hardcoded colours.
 */
import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { Body, Button } from "@/components/ui";
import type { SyncUiState } from "@/lib/offline/types";

export function SyncOpStatus(props: {
  state: SyncUiState;
  error?: { code: string; message: string };
  onRetry?: () => void;
  /** Optional overrides for contextual copy (e.g. check-in vs attendance). */
  title?: string;
  detail?: string;
}) {
  const c = useColors();
  const { hi } = useLocale();

  const styles: Record<SyncUiState, { bg: string; fg: string; title: string; detail: string }> = {
    queued: {
      bg: c.infoSoft,
      fg: c.infoText,
      title: props.title ?? (hi ? "ऑफ़लाइन सहेजा गया" : "Saved offline — will sync"),
      detail:
        props.detail ??
        (hi
          ? "नेटवर्क मिलते ही स्वतः भेजा जाएगा।"
          : "We'll send this when you're back online."),
    },
    syncing: {
      bg: c.warningSoft,
      fg: c.warningText,
      title: props.title ?? (hi ? "सिंक हो रहा है…" : "Syncing…"),
      detail: props.detail ?? (hi ? "कृपया प्रतीक्षा करें।" : "Please wait."),
    },
    synced: {
      bg: c.successSoft,
      fg: c.successText,
      title: props.title ?? (hi ? "सिंक हो गया" : "Synced"),
      detail:
        props.detail ??
        (hi ? "सर्वर पर सुरक्षित। यह संदेश जल्द हट जाएगा।" : "Saved on the server. This will clear shortly."),
    },
    // M22 — a duplicate means the server already had a newer mark than this
    // one; it is not new information reaching the server, so it must never
    // read as "Synced" (that implies THIS change just landed).
    duplicate: {
      bg: c.infoSoft,
      fg: c.infoText,
      title: props.title ?? (hi ? "पहले से अद्यतन" : "Already up to date"),
      detail:
        props.detail ??
        (hi
          ? "सर्वर पर इससे नई जानकारी पहले से मौजूद है — कुछ करने की आवश्यकता नहीं।"
          : "The server already has a newer version of this — nothing more to do."),
    },
    conflict: {
      bg: c.errorSoft,
      fg: c.errorText,
      title: props.title ?? (hi ? "टकराव — अपडेट नहीं हुआ" : "Conflict — not applied"),
      detail:
        props.detail ??
        props.error?.message ??
        (hi
          ? "सर्वर पर नया बदलाव पहले से है। स्क्रीन रीफ़्रेश करें और आवश्यक हो तो फिर से चिह्नित करें।"
          : "A newer change already exists on the server. Refresh the screen and re-mark if needed."),
    },
    failed: {
      bg: c.errorSoft,
      fg: c.errorText,
      title: props.title ?? (hi ? "सिंक विफल" : "Sync failed"),
      detail:
        props.detail ??
        props.error?.message ??
        (hi
          ? "स्वतः प्रयास समाप्त। नीचे से मैन्युअल पुनः प्रयास करें — डेटा हटाया नहीं गया।"
          : "Automatic retries exhausted. Tap retry below — nothing was discarded."),
    },
  };

  const s = styles[props.state];
  if (!s) return null;

  return (
    <View
      style={{
        backgroundColor: s.bg,
        borderRadius: 12,
        padding: 12,
        gap: 8,
        borderWidth: 1,
        borderColor: c.border,
      }}
    >
      <Body style={{ color: s.fg, fontWeight: "600" }}>{s.title}</Body>
      <Body style={{ color: s.fg }}>{s.detail}</Body>
      {props.state === "failed" && props.onRetry ? (
        <Button onPress={props.onRetry} label={hi ? "पुनः प्रयास" : "Retry now"} />
      ) : null}
    </View>
  );
}
