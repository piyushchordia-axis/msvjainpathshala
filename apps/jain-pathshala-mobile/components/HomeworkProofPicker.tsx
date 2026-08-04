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
import {
  PREFERRED_ASSET_REPRESENTATION_MODE,
  guessMime,
  resolveLocalByteSize,
} from "@/lib/proof-media";
import {
  enqueueHomeworkProofUpload,
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
  /** Fired after Submit queues the proof. `offline` when upload did not complete now. */
  onQueued?: (info: { offline: boolean }) => void;
};

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

  function setPicked(uri: string, name: string, mime: string) {
    setLocal({ uri, name, mime });
    setStatusText(null);
  }

  async function submitProof() {
    if (!local || disabled || busy) return;
    setBusy(true);
    setStatusText(hi ? "अपलोड हो रहा है…" : "Uploading…");
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

      const offline = !result.remote_url;
      setStatusText(
        offline
          ? hi
            ? "ऑफ़लाइन सहेजा गया — कनेक्ट होने पर अपलोड होगा।"
            : "Saved offline — will upload when you reconnect."
          : hi
            ? "प्रस्तुत हो गया।"
            : "Submitted.",
      );
      onQueued?.({ offline });
    } catch (err) {
      setStatusText(null);
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
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      preferredAssetRepresentationMode: PREFERRED_ASSET_REPRESENTATION_MODE,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
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
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      preferredAssetRepresentationMode: PREFERRED_ASSET_REPRESENTATION_MODE,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mime = guessMime("photo", asset.mimeType);
    const name = asset.fileName ?? "homework.jpg";
    setPicked(asset.uri, name, mime);
  }

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
              label={hi ? "भेजें" : "Submit"}
              icon="checkmark"
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
              }}
            />
          </Row>
        </View>
      ) : null}
      {statusText ? (
        <Body muted style={{ fontSize: 12 }}>
          {statusText}
        </Body>
      ) : null}
    </View>
  );
}
