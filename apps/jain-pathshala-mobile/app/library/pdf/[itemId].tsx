import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Pdf from "react-native-pdf";

import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";
import { Screen, StateView } from "@/components/ui";
import {
  type DownloadedPdf,
  getDownloadedPdf,
  setLastReadPage,
} from "@/lib/library/downloaded-pdfs";
import { reportLibraryAccess } from "@/lib/library/access-log";

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
 */
export default function LibraryPdfViewer() {
  const { itemId: raw } = useLocalSearchParams<{ itemId: string }>();
  const itemId = String(raw ?? "");
  const c = useColors();
  const { hi } = useLocale();
  const insets = useSafeAreaInsets();

  const [row, setRow] = useState<DownloadedPdf | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  // A ref as well as state: the unmount effect must read the latest page
  // without re-subscribing (and re-saving) on every turn.
  const pageRef = useRef(1);

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
      if (found?.status === "complete") {
        // §17.9 — pdf_view fires when the reader actually opens the viewer.
        reportLibraryAccess({ itemId }, "pdf_view");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

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

  if (loading) {
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
