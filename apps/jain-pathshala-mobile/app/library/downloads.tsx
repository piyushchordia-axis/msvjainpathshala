import { Alert, Pressable, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useLocale } from "@/contexts/LocaleContext";
import { useColors } from "@/hooks/useColors";
import { formatBytes } from "@/lib/library/downloaded-audio";
import { useLibraryDownload } from "@/contexts/LibraryDownloadContext";
import { useLibraryAudio } from "@/contexts/LibraryAudioContext";
import { Body, Button, Card, Row, Screen, StateView, Title } from "@/components/ui";

type DownloadRowStatus = "queued" | "downloading" | "complete" | "failed";

/**
 * Downloads — v3 §17.4 lists PDFs alongside audio, with individual and total
 * sizes, per-item delete, and delete-all.
 *
 * Two sections rather than one merged list: the tap action differs (play vs
 * read), and a reader looking for "that granth I saved" should not have to scan
 * past forty stavans to find it.
 */
export default function LibraryDownloadsScreen() {
  const { hi } = useLocale();
  const c = useColors();
  const {
    rows,
    pdfRows,
    totalBytes,
    audioBytes,
    pdfBytes,
    remove,
    removePdf,
    clearAll,
    getProgress,
    getPdfProgress,
  } = useLibraryDownload();
  const { playTrack, track, stop } = useLibraryAudio();

  const empty = rows.length === 0 && pdfRows.length === 0;

  const confirmClear = () => {
    Alert.alert(
      hi ? "सभी हटाएँ?" : "Delete all downloads?",
      hi
        ? "डिवाइस से सारा डाउनलोड किया गया ऑडियो और पीडीएफ हट जाएगा।"
        : "This removes every downloaded audio file and PDF from this device.",
      [
        { text: hi ? "रद्द" : "Cancel", style: "cancel" },
        {
          text: hi ? "हटाएँ" : "Delete all",
          style: "destructive",
          onPress: () => {
            if (track) stop();
            void clearAll();
          },
        },
      ],
    );
  };

  function statusLine(status: DownloadRowStatus, sizeBytes: number, progress: number): string {
    if (status === "complete") return formatBytes(sizeBytes);
    if (status === "failed") return hi ? "विफल" : "Failed";
    if (status === "queued") return hi ? "कतार में" : "Queued";
    const pct = progress > 0 ? `${Math.round(progress * 100)}%` : formatBytes(sizeBytes);
    return `${hi ? "डाउनलोड" : "Downloading"} · ${pct}`;
  }

  return (
    <Screen contentStyle={{ paddingBottom: 120 }}>
      <Body muted style={{ marginBottom: 12, fontSize: 13 }}>
        {hi ? `कुल ${formatBytes(totalBytes)}` : `Total ${formatBytes(totalBytes)}`}
      </Body>

      {empty ? (
        <StateView
          status="empty"
          emptyText={
            hi
              ? "अभी कोई डाउनलोड नहीं है।"
              : "No downloads yet."
          }
        />
      ) : (
        <>
          <View style={{ marginBottom: 12 }}>
            <Button
              label={hi ? "सभी हटाएँ" : "Delete all"}
              icon="trash-outline"
              variant="outline"
              onPress={confirmClear}
            />
          </View>

          {rows.length > 0 ? (
            <Title style={{ fontSize: 14, lineHeight: 22, color: c.mutedForeground, marginBottom: 6 }}>
              {hi ? `ऑडियो · ${formatBytes(audioBytes)}` : `Audio · ${formatBytes(audioBytes)}`}
            </Title>
          ) : null}

          {rows.map((row) => {
            const title = hi
              ? row.title_hi || row.title_en || row.title_gu
              : row.title_en || row.title_hi || row.title_gu;
            return (
              <Card key={`audio-${row.itemId}`}>
                <Pressable
                  onPress={() => {
                    if (row.status !== "complete") return;
                    void playTrack({
                      itemId: row.itemId,
                      title_en: row.title_en,
                      title_hi: row.title_hi,
                      title_gu: row.title_gu,
                      localUri: row.localPath,
                      source: "local",
                    });
                  }}
                  disabled={row.status !== "complete"}
                >
                  <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Title style={{ fontSize: 15, lineHeight: 22 }}>
                        {title || row.itemId}
                      </Title>
                      <Body muted style={{ marginTop: 4, fontSize: 12, lineHeight: 18 }}>
                        {statusLine(row.status, row.sizeBytes, getProgress(row.itemId))}
                      </Body>
                    </View>
                    <Pressable
                      onPress={() => {
                        if (track?.itemId === row.itemId) stop();
                        void remove(row.itemId);
                      }}
                      hitSlop={10}
                      accessibilityLabel={hi ? "हटाएँ" : "Delete"}
                    >
                      <Ionicons name="trash-outline" size={20} color={c.destructive} />
                    </Pressable>
                  </Row>
                </Pressable>
              </Card>
            );
          })}

          {pdfRows.length > 0 ? (
            <Title
              style={{
                fontSize: 14,
                lineHeight: 22,
                color: c.mutedForeground,
                marginTop: rows.length > 0 ? 16 : 0,
                marginBottom: 6,
              }}
            >
              {hi ? `पीडीएफ · ${formatBytes(pdfBytes)}` : `PDFs · ${formatBytes(pdfBytes)}`}
            </Title>
          ) : null}

          {pdfRows.map((row) => {
            const title = hi
              ? row.title_hi || row.title_en || row.title_gu
              : row.title_en || row.title_hi || row.title_gu;
            const place =
              row.status === "complete" && row.lastReadPage > 1
                ? hi
                  ? ` · पृष्ठ ${row.lastReadPage}${row.pageCount ? ` / ${row.pageCount}` : ""}`
                  : ` · page ${row.lastReadPage}${row.pageCount ? ` of ${row.pageCount}` : ""}`
                : "";
            return (
              <Card key={`pdf-${row.itemId}`}>
                <Pressable
                  onPress={() => {
                    if (row.status !== "complete") return;
                    router.push(`/library/pdf/${row.itemId}` as never);
                  }}
                  disabled={row.status !== "complete"}
                >
                  <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Title style={{ fontSize: 15, lineHeight: 22 }}>
                        {title || row.itemId}
                      </Title>
                      <Body muted style={{ marginTop: 4, fontSize: 12, lineHeight: 18 }}>
                        {statusLine(row.status, row.sizeBytes, getPdfProgress(row.itemId))}
                        {place}
                      </Body>
                    </View>
                    <Pressable
                      onPress={() => void removePdf(row.itemId)}
                      hitSlop={10}
                      accessibilityLabel={hi ? "हटाएँ" : "Delete"}
                    >
                      <Ionicons name="trash-outline" size={20} color={c.destructive} />
                    </Pressable>
                  </Row>
                </Pressable>
              </Card>
            );
          })}

          <Body muted style={{ marginTop: 8, fontSize: 13, textAlign: "center" }}>
            {hi
              ? `कुल भंडारण: ${formatBytes(totalBytes)}`
              : `Storage used: ${formatBytes(totalBytes)}`}
          </Body>
        </>
      )}
    </Screen>
  );
}
