/**
 * Homework proof picker — camera/gallery select a local photo for preview;
 * Submit uploads via jp.queue.media_uploads then homework_submissions.
 */
import { useState } from "react";
import { Alert, Image, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { apiUpload } from "@/lib/api";
import { pickMediaAsset } from "@/lib/image-pick";
import { guessMime, resolveLocalByteSize } from "@/lib/proof-media";
import {
  enqueueHomeworkProofUpload,
  type HomeworkProofSyncState,
} from "@/lib/offline/media-upload-queue";
import { enqueueHomeworkSubmission, drainQueues } from "@/lib/offline/sync-engine";
import { Body, Button, Row } from "@/components/ui";

export { resumeHomeworkProofUploads } from "@/lib/offline/media-upload-queue";

type LocalProof = {
  uri: string;
  name: string;
  mime: string;
};

type Props = {
  assignmentId: string;
  submissionId: string;
  studentId: string;
  disabled?: boolean;
  /**
   * Fired after Submit finishes a drain attempt.
   * `offline` when still queued locally; only call parents' "submitted" UX on synced.
   */
  onQueued?: (info: { offline: boolean; sync_state: HomeworkProofSyncState }) => void;
};

function statusCopy(
  hi: boolean,
  sync_state: HomeworkProofSyncState,
  error_message?: string,
): string {
  if (sync_state === "synced") {
    return hi ? "प्रस्तुत हो गया।" : "Submitted.";
  }
  if (sync_state === "queued") {
    return hi
      ? "ऑफ़लाइन सहेजा गया — कनेक्ट होने पर अपलोड होगा।"
      : "Saved offline — will upload when you reconnect.";
  }
  if (sync_state === "conflict") {
    return (
      error_message ??
      (hi
        ? "यह कार्य सर्वर पर नए अपडेट से टकराता है — स्क्रीन रीफ़्रेश करें।"
        : "This conflicts with a newer update on the server — refresh and try again.")
    );
  }
  return (
    error_message ??
    (hi
      ? "प्रस्तुत नहीं हो सका — फिर से प्रयास करें।"
      : "Could not submit — check the file and try again.")
  );
}

export function HomeworkProofPicker({
  assignmentId,
  submissionId,
  studentId,
  disabled,
  onQueued,
}: Props) {
  const c = useColors();
  const { hi } = useLocale();
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<LocalProof | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [lastSyncState, setLastSyncState] = useState<HomeworkProofSyncState | null>(null);

  function setPicked(uri: string, name: string, mime: string) {
    setLocal({ uri, name, mime });
    setStatusText(null);
    setLastSyncState(null);
  }

  async function submitProof() {
    if (!local || disabled || busy) return;
    setBusy(true);
    setStatusText(hi ? "अपलोड हो रहा है…" : "Uploading…");
    setLastSyncState(null);
    try {
      const sizeBytes = await resolveLocalByteSize(local.uri);
      const result = await enqueueHomeworkProofUpload(
        {
          uri: local.uri,
          name: local.name,
          mime: local.mime,
          sizeBytes,
          hi,
          assignment_id: assignmentId,
          student_id: studentId,
          submission_id: submissionId,
        },
        {
          upload: apiUpload,
          enqueueHomework: enqueueHomeworkSubmission,
          drainSync: drainQueues,
        },
      );

      if (result.status === "rejected") {
        setStatusText(null);
        Alert.alert(hi ? "फ़ाइल बहुत बड़ी" : "File too large", result.message);
        return;
      }

      const sync_state = result.sync_state;
      setLastSyncState(sync_state);
      setStatusText(statusCopy(hi, sync_state, result.error_message));

      if (sync_state === "failed" || sync_state === "conflict") {
        Alert.alert(
          hi ? "प्रस्तुत नहीं हुआ" : "Not submitted",
          statusCopy(hi, sync_state, result.error_message),
        );
      }

      onQueued?.({
        offline: sync_state === "queued",
        sync_state,
      });
    } catch (err) {
      setStatusText(null);
      setLastSyncState("failed");
      Alert.alert(
        hi ? "सहेजा नहीं जा सका" : "Could not save",
        err instanceof Error
          ? err.message
          : hi
            ? "फिर से प्रयास करें।"
            : "Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function pickFromLibrary() {
    if (disabled || busy) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        hi ? "अनुमति आवश्यक" : "Permission needed",
        hi ? "फोटो लाइब्रेरी की अनुमति दें।" : "Please allow photo library access.",
      );
      return;
    }
    const asset = await pickMediaAsset({ source: "library", mediaTypes: ["images"] });
    if (!asset) return;
    const mime = guessMime("photo", asset.mimeType);
    const name = asset.fileName ?? "homework.jpg";
    setPicked(asset.uri, name, mime);
  }

  async function captureCamera() {
    if (disabled || busy) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        hi ? "अनुमति आवश्यक" : "Permission needed",
        hi ? "कैमरा अनुमति दें।" : "Please allow camera access.",
      );
      return;
    }
    const asset = await pickMediaAsset({ source: "camera", mediaTypes: ["images"] });
    if (!asset) return;
    const mime = guessMime("photo", asset.mimeType);
    const name = asset.fileName ?? "homework.jpg";
    setPicked(asset.uri, name, mime);
  }

  const showRetry = lastSyncState === "failed" && !!local;

  return (
    <View style={{ gap: 10 }}>
      <Body style={{ fontSize: 13 }}>
        {hi ? "फ़ोटो से प्रस्तुत करें" : "Submit with a photo"}
      </Body>
      <Row style={{ gap: 10, flexWrap: "wrap" }}>
        <Button
          label={hi ? "कैमरा" : "Camera"}
          variant="primary"
          icon="camera-outline"
          disabled={disabled || busy}
          onPress={() => void captureCamera()}
          style={{ minWidth: 110 }}
        />
        <Button
          label={hi ? "गैलरी" : "Gallery"}
          variant="outline"
          icon="images-outline"
          disabled={disabled || busy}
          onPress={() => void pickFromLibrary()}
          style={{ minWidth: 110 }}
        />
      </Row>
      {local ? (
        <View style={{ gap: 10 }}>
          <Image
            source={{ uri: local.uri }}
            style={{
              width: "100%",
              height: 220,
              borderRadius: c.radius,
              backgroundColor: c.muted,
            }}
            resizeMode="contain"
          />
          <Row style={{ gap: 10, flexWrap: "wrap" }}>
            <Button
              label={
                showRetry
                  ? hi
                    ? "फिर से प्रयास करें"
                    : "Retry"
                  : hi
                    ? "भेजें"
                    : "Submit"
              }
              icon={showRetry ? "refresh" : "checkmark"}
              loading={busy}
              disabled={disabled || busy}
              style={{ flex: 1, minWidth: 120 }}
              onPress={() => void submitProof()}
            />
            <Button
              label={hi ? "फोटो बदलें" : "Change photo"}
              variant="ghost"
              disabled={disabled || busy}
              onPress={() => {
                setLocal(null);
                setStatusText(null);
                setLastSyncState(null);
              }}
            />
          </Row>
        </View>
      ) : null}
      {statusText ? (
        <Body
          muted={lastSyncState !== "failed" && lastSyncState !== "conflict"}
          style={{
            fontSize: 12,
            color:
              lastSyncState === "failed" || lastSyncState === "conflict"
                ? c.destructive
                : undefined,
          }}
        >
          {statusText}
        </Body>
      ) : null}
    </View>
  );
}
