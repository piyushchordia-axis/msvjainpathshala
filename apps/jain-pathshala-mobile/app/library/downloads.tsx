import { Alert, Pressable, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useLocale } from "@/contexts/LocaleContext";
import { useColors } from "@/hooks/useColors";
import { formatBytes } from "@/lib/library/downloaded-audio";
import { useLibraryDownload } from "@/contexts/LibraryDownloadContext";
import { useLibraryAudio } from "@/contexts/LibraryAudioContext";
import { Body, Button, Card, ProgressBar, Row, Screen, StateView, Title } from "@/components/ui";

type DownloadRowStatus = "queued" | "downloading" | "complete" | "failed";

/**
 * Downloads — v3 §17.4 lists PDFs alongside audio, with individual and total
 * sizes, per-item delete, and delete-all.
 *
 * Two sections rather than one merged list: the tap action differs (play vs
 * read), and a reader looking for "that granth I saved" should not have to scan
 * past forty stavans to find it.
 *
 * A failed row used to be a dead end — the word "Failed" and a delete button.
 * Retry existed on the download context the whole time and worked from the
 * local record alone, but the only button wired to it lived on the item card,
 * back in whichever section the reader had come from.
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
    retry,
    retryPdf,
    clearAll,
    getProgress,
    getPdfProgress,
  } = useLibraryDownload();
  const { playTrack, track, playing, stop } = useLibraryAudio();

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
    if (status === "failed") {
      // State the problem AND the fix — the row now carries the fix.
      return hi ? "डाउनलोड पूरा नहीं हुआ" : "Download didn't finish";
    }
    if (status === "queued") return hi ? "कतार में" : "Queued";
    const pct = progress > 0 ? `${Math.round(progress * 100)}%` : formatBytes(sizeBytes);
    return `${hi ? "डाउनलोड" : "Downloading"} · ${pct}`;
  }

  /** Shared trailing controls: retry when it failed, delete always. */
  function RowActions({
    status,
    onRetry,
    onDelete,
  }: {
    status: DownloadRowStatus;
    onRetry: () => void;
    onDelete: () => void;
  }) {
    return (
      <Row style={{ alignItems: "center", gap: 4 }}>
        {status === "failed" ? (
          <Pressable
            onPress={onRetry}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={hi ? "फिर से डाउनलोड करें" : "Retry download"}
            style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="refresh-outline" size={20} color={c.primary} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={onDelete}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={hi ? "हटाएँ" : "Delete"}
          style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="trash-outline" size={20} color={c.destructive} />
        </Pressable>
      </Row>
    );
  }

  return (
    <Screen contentStyle={{ paddingBottom: 140 }}>
      <Body muted style={{ marginBottom: 12, fontSize: 13 }}>
        {hi ? `कुल ${formatBytes(totalBytes)}` : `Total ${formatBytes(totalBytes)}`}
      </Body>

      {empty ? (
        <StateView
          status="empty"
          emptyText={
            hi
              ? "अभी कोई डाउनलोड नहीं है। किसी स्तवन पर डाउनलोड दबाएँ — फिर वह बिना इंटरनेट भी चलेगा।"
              : "No downloads yet. Tap Download on any stavan and it will play without internet."
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
            const ready = row.status === "complete";
            const isCurrent = track?.itemId === row.itemId;
            const progress = getProgress(row.itemId);
            return (
              <Card key={`audio-${row.itemId}`}>
                <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <Pressable
                    onPress={() => {
                      if (!ready) return;
                      void playTrack({
                        itemId: row.itemId,
                        title_en: row.title_en,
                        title_hi: row.title_hi,
                        title_gu: row.title_gu,
                        localUri: row.localPath,
                        source: "local",
                      });
                    }}
                    disabled={!ready}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !ready, selected: isCurrent }}
                    accessibilityLabel={
                      ready
                        ? `${isCurrent && playing ? (hi ? "रोकें" : "Pause") : hi ? "चलाएँ" : "Play"} ${title || row.itemId}`
                        : title || row.itemId
                    }
                    style={{ flex: 1, paddingRight: 8, minHeight: 44, justifyContent: "center" }}
                  >
                    <Row style={{ alignItems: "center", gap: 10 }}>
                      {/* A row that plays on tap should look like it plays on
                          tap. Before this the only cue was that tapping worked. */}
                      <Ionicons
                        name={
                          !ready
                            ? "cloud-download-outline"
                            : isCurrent && playing
                              ? "pause-circle"
                              : "play-circle"
                        }
                        size={28}
                        color={ready ? c.primary : c.mutedForeground}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Title style={{ fontSize: 15, lineHeight: 22 }}>
                          {title || row.itemId}
                        </Title>
                        <Body muted style={{ marginTop: 4, fontSize: 12, lineHeight: 18 }}>
                          {statusLine(row.status, row.sizeBytes, progress)}
                        </Body>
                      </View>
                    </Row>
                  </Pressable>
                  <RowActions
                    status={row.status}
                    onRetry={() => void retry(row.itemId)}
                    onDelete={() => {
                      if (isCurrent) stop();
                      void remove(row.itemId);
                    }}
                  />
                </Row>
                {row.status === "downloading" ? (
                  <View style={{ marginTop: 8 }}>
                    <ProgressBar value={progress > 0 ? progress : null} />
                  </View>
                ) : null}
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
            const ready = row.status === "complete";
            const progress = getPdfProgress(row.itemId);
            const place =
              ready && row.lastReadPage > 1
                ? hi
                  ? ` · पृष्ठ ${row.lastReadPage}${row.pageCount ? ` / ${row.pageCount}` : ""}`
                  : ` · page ${row.lastReadPage}${row.pageCount ? ` of ${row.pageCount}` : ""}`
                : "";
            return (
              <Card key={`pdf-${row.itemId}`}>
                <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <Pressable
                    onPress={() => {
                      if (!ready) return;
                      router.push(`/library/pdf/${row.itemId}` as never);
                    }}
                    disabled={!ready}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !ready }}
                    accessibilityLabel={
                      ready
                        ? `${hi ? "खोलें" : "Open"} ${title || row.itemId}`
                        : title || row.itemId
                    }
                    style={{ flex: 1, paddingRight: 8, minHeight: 44, justifyContent: "center" }}
                  >
                    <Row style={{ alignItems: "center", gap: 10 }}>
                      <Ionicons
                        name={ready ? "document-text" : "cloud-download-outline"}
                        size={28}
                        color={ready ? c.primary : c.mutedForeground}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Title style={{ fontSize: 15, lineHeight: 22 }}>
                          {title || row.itemId}
                        </Title>
                        <Body muted style={{ marginTop: 4, fontSize: 12, lineHeight: 18 }}>
                          {statusLine(row.status, row.sizeBytes, progress)}
                          {place}
                        </Body>
                      </View>
                    </Row>
                  </Pressable>
                  <RowActions
                    status={row.status}
                    onRetry={() => void retryPdf(row.itemId)}
                    onDelete={() => void removePdf(row.itemId)}
                  />
                </Row>
                {row.status === "downloading" ? (
                  <View style={{ marginTop: 8 }}>
                    <ProgressBar value={progress > 0 ? progress : null} />
                  </View>
                ) : null}
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
