import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import * as Sharing from "expo-sharing";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";
import { Body, Button, Screen, StateView } from "@/components/ui";
import {
  type DownloadedPdf,
  getDownloadedPdf,
  setLastReadPage,
} from "@/lib/library/downloaded-pdfs";
import { reportLibraryAccess } from "@/lib/library/access-log";
import { useLazyPdfView } from "@/lib/library/pdf-view";

/**
 * §17.1.3 / §17.11.2 — in-app PDF reader.
 *
 * Reads the LOCAL file only. A PDF reaches this screen because the reader
 * downloaded it, and re-fetching over the network here would defeat the point
 * of a granth you can open on a train.
 *
 * `lastReadPage` is restored on open and written on close (v3 Open Decision 6
 * keeps it device-local in v1). Saving on every page turn would mean an
 * AsyncStorage write per swipe; saving on close costs at most one page if the
 * app is killed outright.
 *
 * TWO RENDER PATHS. The native reader only exists in a development / preview /
 * production build; Expo Go has no custom native modules at all. Rather than a
 * dead frame there, the downloaded file is handed to the OS so the reader can
 * still read it — see `@/lib/library/pdf-view` for why the module must never be
 * imported statically.
 */
export default function LibraryPdfViewer() {
  const { itemId: raw } = useLocalSearchParams<{ itemId: string }>();
  const itemId = String(raw ?? "");
  const c = useColors();
  const { hi } = useLocale();
  const insets = useSafeAreaInsets();
  // `undefined` until resolved, then the component or null.
  const Pdf = useLazyPdfView();

  const [row, setRow] = useState<DownloadedPdf | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [handoffFailed, setHandoffFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  // A ref as well as state: the unmount effect must read the latest page
  // without re-subscribing (and re-saving) on every turn.
  const pageRef = useRef(1);
  // §17.9 — one pdf_view per visit, whichever path served it.
  const loggedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getDownloadedPdf(itemId).then((found) => {
      if (cancelled) return;
      setRow(found);
      const start = Math.max(1, found?.lastReadPage ?? 1);
      setPage(start);
      pageRef.current = start;
      setTotalPages(found?.pageCount ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  /**
   * §17.9 — pdf_view means the reader is looking at the PDF, so it fires when
   * the native reader mounts. On the hand-off path it fires on the tap instead
   * (below): landing on a screen that offers to open a file is not reading it,
   * and logging it here would inflate pdf_view for every Expo Go session.
   */
  useEffect(() => {
    if (loggedRef.current) return;
    if (!Pdf || row?.status !== "complete") return;
    loggedRef.current = true;
    reportLibraryAccess({ itemId }, "pdf_view");
  }, [Pdf, row?.status, itemId]);

  // Save on the way out, whichever way they leave.
  useEffect(() => {
    return () => {
      void setLastReadPage(itemId, pageRef.current);
    };
  }, [itemId]);

  const onPageChanged = useCallback((next: number) => {
    pageRef.current = next;
    setPage(next);
  }, []);

  const close = useCallback(() => {
    void setLastReadPage(itemId, pageRef.current);
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/library" as never);
  }, [itemId]);

  const title = hi
    ? row?.title_hi || row?.title_en || row?.title_gu || ""
    : row?.title_en || row?.title_hi || row?.title_gu || "";

  /**
   * Hand the downloaded file to whatever the phone already uses to read PDFs.
   * The share sheet is the OS's own "open in…", so this is a real way to read
   * the granth, not an apology for one.
   *
   * The LOCAL file, never `row.pdfUrl`: that is the signed URL captured at
   * download time (§17.4, 1h TTL) and is long expired by the time anyone opens
   * the reader. Falling back to it would hand the reader a 403 page while
   * reporting success.
   */
  const handOff = useCallback(async () => {
    if (!row) return;
    setHandoffFailed(false);
    if (!loggedRef.current) {
      loggedRef.current = true;
      reportLibraryAccess({ itemId }, "pdf_view");
    }
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setHandoffFailed(true);
        return;
      }
      await Sharing.shareAsync(row.localPath, {
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
        dialogTitle: title,
      });
    } catch {
      setHandoffFailed(true);
    }
  }, [row, itemId, title]);

  // `Pdf === undefined` is still resolving — fold it into loading so the
  // hand-off screen never flashes in front of the real reader.
  if (loading || Pdf === undefined) {
    return (
      <Screen>
        <StateView status="loading" emptyText="" />
      </Screen>
    );
  }

  // No local file: the only honest thing to show is how to get one. Never a
  // dead viewer frame (§17.1.3 — no disabled or dead surfaces).
  if (!row || row.status !== "complete" || Platform.OS === "web") {
    return (
      <Screen>
        <StateView
          status="empty"
          emptyText={
            hi
              ? "यह पीडीएफ इस डिवाइस पर नहीं है — सूची में जाकर डाउनलोड करें, फिर खोलें।"
              : "This PDF is not on this device — download it from the list, then open it."
          }
        />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.card, paddingTop: Math.max(insets.top, 12) }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 16,
          paddingBottom: 8,
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: bodyFamily(hi, "semibold"),
            fontSize: 17,
            lineHeight: 26,
            color: c.secondary,
          }}
        >
          {title}
        </Text>
        {/* Only the native reader tracks a page. On the hand-off path a "1"
            here would claim the reader is on page one of something they have
            not opened yet. */}
        {Pdf ? (
          <Text
            style={{
              fontFamily: bodyFamily(hi),
              fontSize: 13,
              lineHeight: 22,
              color: c.mutedForeground,
            }}
          >
            {totalPages ? `${page} / ${totalPages}` : String(page)}
          </Text>
        ) : null}
        <Pressable onPress={close} hitSlop={10} accessibilityLabel={hi ? "बंद करें" : "Close"}>
          <Ionicons name="close" size={26} color={c.mutedForeground} />
        </Pressable>
      </View>

      {failed ? (
        <StateView
          status="error"
          emptyText=""
          errorText={
            hi
              ? "यह पीडीएफ नहीं खुल सका — डाउनलोड अधूरा हो सकता है। इसे हटाकर फिर से डाउनलोड करें।"
              : "This PDF could not be opened — the download may be incomplete. Remove it and download again."
          }
        />
      ) : !Pdf ? (
        // No native reader in this build (Expo Go). The file is on the device
        // and perfectly readable — just not by us — so offer the hand-off
        // rather than a dead frame (§17.1.3: never a disabled or dead surface).
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 }}>
          <Ionicons name="document-text-outline" size={40} color={c.mutedForeground} />
          <Body muted style={{ textAlign: "center" }}>
            {hi
              ? "अंतर्निर्मित रीडर पूरे ऐप बिल्ड में ही चलता है। यह पीडीएफ आप अपने फ़ोन के किसी दूसरे ऐप में खोल सकते हैं।"
              : "The built-in reader needs the full app build. You can still open this PDF in another app on your phone."}
          </Body>
          <Button
            label={hi ? "पीडीएफ खोलें" : "Open PDF"}
            icon="open-outline"
            onPress={() => void handOff()}
          />
          {handoffFailed ? (
            <Body style={{ textAlign: "center", color: c.destructive }}>
              {hi
                ? "इसे खोलने वाला कोई ऐप नहीं मिला — प्ले स्टोर या ऐप स्टोर से कोई पीडीएफ रीडर इंस्टॉल करें, फिर दोबारा कोशिश करें।"
                : "No app on this phone can open a PDF — install a PDF reader from the store, then try again."}
            </Body>
          ) : null}
        </View>
      ) : (
        <Pdf
          source={{ uri: row.localPath }}
          page={Math.max(1, row.lastReadPage || 1)}
          // Pinch-zoom and double-tap zoom are the native gestures; paging is
          // the vertical scroll readers already expect from a scanned granth.
          enablePaging={false}
          enableDoubleTapZoom
          minScale={1}
          maxScale={4}
          fitPolicy={0}
          onLoadComplete={(numberOfPages) => setTotalPages(numberOfPages)}
          onPageChanged={onPageChanged}
          onError={() => setFailed(true)}
          style={{ flex: 1, width: "100%", backgroundColor: c.background }}
        />
      )}
    </View>
  );
}
