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
}) {
  const c = useColors();
  const { hi } = useLocale();

  if (props.state === "duplicate" || props.state === "synced") return null;

  const styles: Record<
    Exclude<SyncUiState, "duplicate" | "synced">,
    { bg: string; fg: string; title: string; detail: string }
  > = {
    queued: {
      bg: c.infoSoft,
      fg: c.infoText,
      title: hi ? "ऑफ़लाइन सहेजा गया" : "Saved offline — will sync",
      detail: hi
        ? "नेटवर्क मिलते ही स्वतः भेजा जाएगा।"
        : "We'll send this when you're back online.",
    },
    syncing: {
      bg: c.warningSoft,
      fg: c.warningText,
      title: hi ? "सिंक हो रहा है…" : "Syncing…",
      detail: hi ? "कृपया प्रतीक्षा करें।" : "Please wait.",
    },
    conflict: {
      bg: c.errorSoft,
      fg: c.errorText,
      title: hi ? "टकराव — अपडेट नहीं हुआ" : "Conflict — not applied",
      detail:
        props.error?.message ??
        (hi
          ? "सर्वर पर नया बदलाव पहले से है। स्क्रीन रीफ़्रेश करें और आवश्यक हो तो फिर से चिह्नित करें।"
          : "A newer change already exists on the server. Refresh the screen and re-mark if needed."),
    },
    failed: {
      bg: c.errorSoft,
      fg: c.errorText,
      title: hi ? "सिंक विफल" : "Sync failed",
      detail:
        props.error?.message ??
        (hi
          ? "स्वतः प्रयास समाप्त। नीचे से मैन्युअल पुनः प्रयास करें — डेटा हटाया नहीं गया।"
          : "Automatic retries exhausted. Tap retry below — nothing was discarded."),
    },
  };

  const s = styles[props.state as keyof typeof styles];
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
