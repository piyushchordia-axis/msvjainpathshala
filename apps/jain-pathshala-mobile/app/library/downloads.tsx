import { Alert, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocale } from "@/contexts/LocaleContext";
import { useColors } from "@/hooks/useColors";
import { formatBytes } from "@/lib/library/downloaded-audio";
import { useLibraryDownload } from "@/contexts/LibraryDownloadContext";
import { useLibraryAudio } from "@/contexts/LibraryAudioContext";
import { Body, Button, Card, Row, Screen, StateView, Title } from "@/components/ui";

export default function LibraryDownloadsScreen() {
  const { hi } = useLocale();
  const c = useColors();
  const { rows, totalBytes, remove, clearAll, getProgress } = useLibraryDownload();
  const { playTrack, track, stop } = useLibraryAudio();

  const confirmClear = () => {
    Alert.alert(
      hi ? "सभी हटाएँ?" : "Delete all downloads?",
      hi
        ? "डिवाइस से सारा डाउनलोड किया गया ऑडियो हट जाएगा।"
        : "This removes every downloaded audio file from this device.",
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

  return (
    <Screen contentStyle={{ paddingBottom: 120 }}>
      <Body muted style={{ marginBottom: 12, fontSize: 13 }}>
        {hi ? `कुल ${formatBytes(totalBytes)}` : `Total ${formatBytes(totalBytes)}`}
      </Body>

      {rows.length === 0 ? (
        <StateView
          status="empty"
          emptyText={hi ? "अभी कोई डाउनलोड नहीं है।" : "No downloaded audio yet."}
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
          {rows.map((row) => {
            const title = hi
              ? row.title_hi || row.title_en || row.title_gu
              : row.title_en || row.title_hi || row.title_gu;
            const progress = getProgress(row.itemId);
            const sizeLabel =
              row.status === "downloading" && progress > 0
                ? `${Math.round(progress * 100)}%`
                : formatBytes(row.sizeBytes);
            return (
              <Card key={row.itemId}>
                <Pressable
                  onPress={() => {
                    if (row.status !== "complete") return;
                    void playTrack({
                      itemId: row.itemId,
                      title_en: row.title_en,
                      title_hi: row.title_hi,
                      title_gu: row.title_gu,
                      localUri: row.localPath,
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
                        {row.status === "complete"
                          ? sizeLabel
                          : row.status === "failed"
                            ? hi
                              ? "विफल"
                              : "Failed"
                            : row.status === "queued"
                              ? hi
                                ? "कतार में"
                                : "Queued"
                              : `${hi ? "डाउनलोड" : "Downloading"} · ${sizeLabel}`}
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
