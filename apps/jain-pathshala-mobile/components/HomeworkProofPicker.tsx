/**
 * Homework proof picker — photo/camera primary path shared with Niyam helpers.
 * Upload goes through jp.queue.media_uploads then homework_submissions (FIX #5/#20).
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

type Props = {
  assignmentId: string;
  submissionId: string;
  studentId: string;
  disabled?: boolean;
  onQueued?: () => void;
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
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  async function runUpload(uri: string, name: string, mime: string) {
    setBusy(true);
    setPreviewUri(uri);
    setStatusText(hi ? "अपलोड कतार में…" : "Queued for upload…");
    try {
      const sizeBytes = await resolveLocalByteSize(uri);
      const result = await enqueueHomeworkProofUpload(
        {
          uri,
          name,
          mime,
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
        setPreviewUri(null);
        setStatusText(null);
        Alert.alert(hi ? "फ़ाइल बहुत बड़ी" : "File too large", result.message);
        return;
      }

      if (result.remote_url) {
        setStatusText(hi ? "सहेज लिया गया — समन्वयित होगा।" : "Saved — will sync.");
        onQueued?.();
      } else {
        setStatusText(
          hi
            ? "ऑफ़लाइन सहेजा गया — कनेक्ट होने पर अपलोड होगा।"
            : "Saved offline — will upload when you reconnect.",
        );
        onQueued?.();
      }
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
    await runUpload(asset.uri, name, mime);
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
    await runUpload(asset.uri, name, mime);
  }

  return (
    <View style={{ gap: 10 }}>
      <Body style={{ fontSize: 13 }}>
        {hi ? "फ़ोटो या फ़ाइल से प्रस्तुत करें" : "Submit with a photo or file"}
      </Body>
      <Row style={{ gap: 10, flexWrap: "wrap" }}>
        <Button
          label={hi ? "कैमरा" : "Camera"}
          variant="primary"
          icon="camera-outline"
          disabled={disabled || busy}
          loading={busy}
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
      {previewUri ? (
        <Image
          source={{ uri: previewUri }}
          style={{
            width: 96,
            height: 96,
            borderRadius: c.radius,
            backgroundColor: c.muted,
          }}
        />
      ) : null}
      {statusText ? (
        <Body muted style={{ fontSize: 12 }}>
          {statusText}
        </Body>
      ) : null}
    </View>
  );
}
