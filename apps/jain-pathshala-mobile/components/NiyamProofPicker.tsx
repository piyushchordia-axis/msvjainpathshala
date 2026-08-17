import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Image, Platform, Pressable, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { apiUpload, ApiError } from "@/lib/api";
import {
  enqueueProofMediaUpload,
  NIYAM_UPLOAD_FOLDER,
} from "@/lib/offline/media-upload-queue";
import { fileTooLargeMessage, rejectIfOverUploadLimit } from "@/lib/upload-size-guard";
import {
  VIDEO_MAX_DURATION_SEC,
  PREFERRED_ASSET_REPRESENTATION_MODE,
  resolveLocalByteSize,
  newProofLocalId,
  guessMime,
  ensureFileUri,
  mediaReady,
  toSubmitMedia,
  type MediaKind,
  type ProofMediaItem,
} from "@/lib/proof-media";
import { Body, Button, Row } from "@/components/ui";

export type { MediaKind, ProofMediaItem };
export { mediaReady, toSubmitMedia };

type PendingAudio = {
  uri: string;
  name: string;
  mime: string;
  blob?: Blob;
};

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Props = {
  proofType: string;
  proofRequired: boolean;
  maxUploads: number;
  value: ProofMediaItem[];
  onChange: (items: ProofMediaItem[]) => void;
  disabled?: boolean;
};

function allowedKinds(proofType: string): MediaKind[] {
  if (proofType === "photo") return ["photo"];
  if (proofType === "video") return ["video"];
  if (proofType === "audio") return ["audio"];
  if (proofType === "either") return ["photo", "video"];
  if (proofType === "any") return ["photo", "video", "audio"];
  return ["photo", "video"];
}

async function uploadUri(
  uri: string,
  name: string,
  type: string,
): Promise<{ url: string; mime: string; size: number }> {
  const result = await apiUpload({ uri, name, type });
  return { url: result.url, mime: result.content_type, size: result.size };
}

/** Web MediaRecorder helpers live inside the component; keep this file free of dead top-level stubs. */

export function NiyamProofPicker({
  proofType,
  proofRequired,
  maxUploads,
  value,
  onChange,
  disabled,
}: Props) {
  const c = useColors();
  const { hi } = useLocale();
  const kinds = allowedKinds(proofType);
  const atCap = value.length >= maxUploads || maxUploads <= 0;
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder, 200);
  const [audioReady, setAudioReady] = useState(Platform.OS === "web");
  const [webRecording, setWebRecording] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);
  // Bind source to pending URI so the player reloads when a take is ready
  // (replace()+immediate play often fails silently after a recording session).
  const previewPlayer = useAudioPlayer(pendingAudio?.uri ?? null, { updateInterval: 200 });
  const previewStatus = useAudioPlayerStatus(previewPlayer);
  const webStopRef = useRef<(() => void) | null>(null);
  const webChunksRef = useRef<BlobPart[]>([]);
  const webRecorderRef = useRef<MediaRecorder | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const isRecordingNative = recorderState.isRecording;
  const isRecording = isRecordingNative || webRecording;

  // Wall-clock timer — iOS durationMillis often stays 0 even while audio is captured.
  useEffect(() => {
    if (!isRecording) {
      setRecordingElapsedMs(0);
      return;
    }
    const started = Date.now();
    setRecordingElapsedMs(0);
    const id = setInterval(() => setRecordingElapsedMs(Date.now() - started), 200);
    return () => clearInterval(id);
  }, [isRecording]);

  const pendingAudioRef = useRef<PendingAudio | null>(null);
  pendingAudioRef.current = pendingAudio;
  useEffect(() => {
    return () => {
      const draft = pendingAudioRef.current;
      if (draft?.blob && draft.uri.startsWith("blob:")) {
        URL.revokeObjectURL(draft.uri);
      }
    };
  }, []);

  useEffect(() => {
    if (!kinds.includes("audio") || Platform.OS === "web") return;
    void (async () => {
      try {
        const status = await AudioModule.requestRecordingPermissionsAsync();
        if (status.granted) {
          await setAudioModeAsync({
            playsInSilentMode: true,
            allowsRecording: true,
            shouldRouteThroughEarpiece: false,
            interruptionMode: "doNotMix",
          });
          setAudioReady(true);
        } else {
          setAudioReady(false);
        }
      } catch {
        setAudioReady(false);
      }
    })();
  }, [kinds]);

  const patch = useCallback(
    (localId: string, patchItem: Partial<ProofMediaItem>) => {
      onChange(valueRef.current.map((m) => (m.localId === localId ? { ...m, ...patchItem } : m)));
    },
    [onChange],
  );

  const remove = useCallback(
    (localId: string) => {
      onChange(valueRef.current.filter((m) => m.localId !== localId));
    },
    [onChange],
  );

  const uploadErrorMessage = useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        if (err.code === "ERR_FILE_TOO_LARGE" && hi) return fileTooLargeMessage(true);
        return err.message;
      }
      return hi ? "अपलोड विफल।" : "Upload failed.";
    },
    [hi],
  );

  const enqueueUpload = useCallback(
    async (kind: MediaKind, uri: string, name: string, mime: string, blob?: Blob) => {
      const uploadUri = kind === "audio" ? ensureFileUri(uri) : uri;
      const sizeBytes = await resolveLocalByteSize(uploadUri, blob);
      const overLimit = rejectIfOverUploadLimit(sizeBytes, hi);
      if (overLimit) {
        Alert.alert(hi ? "फ़ाइल बहुत बड़ी" : "File too large", overLimit);
        return;
      }

      const localId = newProofLocalId();
      const placeholder: ProofMediaItem = {
        localId,
        kind,
        url: "",
        previewUri: uploadUri,
        status: "uploading",
        mime,
      };
      onChange([...valueRef.current, placeholder]);

      // Route through the durable media queue instead of a bare apiUpload. The
      // direct call failed outright out of signal, marked the item `failed`, and
      // `mediaReady` then disabled Submit — so a parent who photographed proof
      // offline lost the photo AND could not submit at all. Online this still
      // uploads inline and returns `uploaded`, so nothing changes on a good link.
      const result = await enqueueProofMediaUpload({
        uri: uploadUri,
        name,
        mime,
        sizeBytes,
        hi,
        folder: NIYAM_UPLOAD_FOLDER,
      });

      if (result.status === "rejected") {
        onChange(valueRef.current.filter((m) => m.localId !== localId));
        Alert.alert(hi ? "फ़ाइल बहुत बड़ी" : "File too large", result.message);
        return;
      }

      onChange(
        valueRef.current.map((m) =>
          m.localId === localId
            ? result.status === "uploaded"
              ? {
                  ...m,
                  url: result.remote_url,
                  mime: result.mime ?? mime,
                  size_bytes: result.size_bytes ?? m.size_bytes,
                  status: "ready" as const,
                  error: undefined,
                  mediaUploadId: result.id,
                }
              : {
                  ...m,
                  status: "queued" as const,
                  error: undefined,
                  mediaUploadId: result.id,
                }
            : m,
        ),
      );
    },
    [hi, onChange],
  );

  async function retry(item: ProofMediaItem) {
    if (!item.previewUri) return;
    patch(item.localId, { status: "uploading", error: undefined });
    const mime = guessMime(item.kind, item.mime);
    const name =
      item.kind === "audio"
        ? "recording.m4a"
        : item.kind === "video"
          ? "proof.mp4"
          : "proof.jpg";
    const uri = ensureFileUri(item.previewUri);
    // Same queue as the first attempt — a manual retry that is still offline
    // parks the file durably rather than dropping back to `failed`.
    const result = await enqueueProofMediaUpload({
      uri,
      name,
      mime,
      sizeBytes: item.size_bytes ?? (await resolveLocalByteSize(uri)),
      hi,
      folder: NIYAM_UPLOAD_FOLDER,
    });
    if (result.status === "rejected") {
      patch(item.localId, { status: "failed", error: result.message });
      return;
    }
    patch(
      item.localId,
      result.status === "uploaded"
        ? {
            url: result.remote_url,
            mime: result.mime ?? mime,
            size_bytes: result.size_bytes ?? item.size_bytes,
            status: "ready",
            error: undefined,
            mediaUploadId: result.id,
          }
        : { status: "queued", error: undefined, mediaUploadId: result.id },
    );
  }

  async function pickFromLibrary(media: "images" | "videos") {
    if (atCap || disabled) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        hi ? "अनुमति आवश्यक" : "Permission needed",
        hi ? "फोटो लाइब्रेरी की अनुमति दें।" : "Please allow photo library access.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: [media],
      quality: 0.85,
      videoMaxDuration: VIDEO_MAX_DURATION_SEC,
      preferredAssetRepresentationMode: PREFERRED_ASSET_REPRESENTATION_MODE,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const isVideo =
      media === "videos" ||
      (asset.type ?? "").includes("video") ||
      (asset.mimeType ?? "").startsWith("video/");
    const kind: MediaKind = isVideo ? "video" : "photo";
    if (!kinds.includes(kind)) {
      Alert.alert(
        hi ? "अमान्य प्रकार" : "Not allowed",
        hi ? "यह मीडिया प्रकार अनुमत नहीं है।" : "This media kind is not allowed.",
      );
      return;
    }
    const mime = guessMime(kind, asset.mimeType);
    const name = asset.fileName ?? (isVideo ? "proof.mp4" : "proof.jpg");
    await enqueueUpload(kind, asset.uri, name, mime);
  }

  async function captureCamera(kind: "photo" | "video") {
    if (atCap || disabled) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        hi ? "अनुमति आवश्यक" : "Permission needed",
        hi ? "कैमरा अनुमति दें।" : "Please allow camera access.",
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: [kind === "video" ? "videos" : "images"],
      quality: 0.85,
      videoMaxDuration: VIDEO_MAX_DURATION_SEC,
      preferredAssetRepresentationMode: PREFERRED_ASSET_REPRESENTATION_MODE,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mime = guessMime(kind, asset.mimeType);
    const name = asset.fileName ?? (kind === "video" ? "proof.mp4" : "proof.jpg");
    await enqueueUpload(kind, asset.uri, name, mime);
  }

  async function setRecordingAudioMode(): Promise<void> {
    if (Platform.OS === "web") return;
    await setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
      shouldRouteThroughEarpiece: false,
      interruptionMode: "doNotMix",
    });
  }

  /** Leave playAndRecord so preview routes to the loudspeaker, not the earpiece. */
  async function setPlaybackAudioMode(): Promise<void> {
    if (Platform.OS === "web") return;
    await setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
      shouldRouteThroughEarpiece: false,
      interruptionMode: "doNotMix",
    });
  }

  async function ensureNativeMic(): Promise<boolean> {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        Alert.alert(
          hi ? "माइक आवश्यक" : "Microphone needed",
          hi ? "ऑडियो रिकॉर्ड करने की अनुमति दें।" : "Please allow microphone access to record audio.",
        );
        return false;
      }
      await setRecordingAudioMode();
      setAudioReady(true);
      return true;
    } catch (err) {
      Alert.alert(
        hi ? "माइक उपलब्ध नहीं" : "Microphone unavailable",
        hi
          ? "इस बिल्ड में ऑडियो रिकॉर्डिंग उपलब्ध नहीं है।"
          : err instanceof Error
            ? err.message
            : "Audio recording is not available in this build.",
      );
      return false;
    }
  }

  function discardPendingAudio() {
    try {
      previewPlayer.pause();
    } catch {
      /* ignore */
    }
    if (pendingAudio?.blob && pendingAudio.uri.startsWith("blob:")) {
      URL.revokeObjectURL(pendingAudio.uri);
    }
    setPendingAudio(null);
    void setRecordingAudioMode();
  }

  async function playPendingAudio() {
    if (!pendingAudio) return;
    try {
      if (previewStatus.playing) {
        previewPlayer.pause();
        return;
      }
      // Recording leaves the session in playAndRecord (often earpiece / inaudible).
      // Always flip to playback mode before Play.
      await setPlaybackAudioMode();
      previewPlayer.volume = 1;
      previewPlayer.replace(pendingAudio.uri);
      await new Promise((r) => setTimeout(r, 150));
      await previewPlayer.seekTo(0);
      previewPlayer.play();
    } catch (err) {
      Alert.alert(
        hi ? "प्लेबैक विफल" : "Playback failed",
        err instanceof Error
          ? err.message
          : hi
            ? "ऑडियो चलाया नहीं जा सका।"
            : "Could not play the recording.",
      );
    }
  }

  async function keepPendingAudio() {
    if (!pendingAudio || atCap || disabled) return;
    try {
      previewPlayer.pause();
    } catch {
      /* ignore */
    }
    const draft = pendingAudio;
    setPendingAudio(null);
    await enqueueUpload("audio", draft.uri, draft.name, draft.mime, draft.blob);
  }

  async function startWebRecording() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      Alert.alert(
        hi ? "समर्थित नहीं" : "Not supported",
        hi ? "इस ब्राउज़र में ऑडियो रिकॉर्डिंग उपलब्ध नहीं है।" : "Audio recording is not supported in this browser.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      webChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) webChunksRef.current.push(e.data);
      };
      webRecorderRef.current = recorder;
      webStopRef.current = () => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(webChunksRef.current, { type: mime });
          const uri = URL.createObjectURL(blob);
          const name = mime.includes("mp4") ? "recording.m4a" : "recording.webm";
          setPendingAudio({ uri, name, mime, blob });
          setWebRecording(false);
          webRecorderRef.current = null;
          webStopRef.current = null;
        };
        recorder.stop();
      };
      recorder.start();
      setWebRecording(true);
    } catch {
      Alert.alert(
        hi ? "माइक आवश्यक" : "Microphone needed",
        hi ? "ऑडियो रिकॉर्ड करने की अनुमति दें।" : "Please allow microphone access to record audio.",
      );
    }
  }

  async function toggleRecord() {
    if (disabled || pendingAudio || (!recorderState.isRecording && !webRecording && atCap)) return;

    if (Platform.OS === "web") {
      if (webRecording) {
        webStopRef.current?.();
        return;
      }
      await startWebRecording();
      return;
    }

    if (!(await ensureNativeMic())) return;

    try {
      if (recorderState.isRecording) {
        await audioRecorder.stop();
        const rawUri = audioRecorder.uri;
        if (!rawUri) {
          Alert.alert(hi ? "त्रुटि" : "Error", hi ? "रिकॉर्डिंग सहेजी नहीं गई।" : "Recording was not saved.");
          return;
        }
        const uri = ensureFileUri(rawUri);
        // Switch out of recording session before preview so Play is audible.
        await setPlaybackAudioMode();
        setPendingAudio({ uri, name: "recording.m4a", mime: "audio/mp4" });
      } else {
        try {
          previewPlayer.pause();
        } catch {
          /* ignore */
        }
        await setRecordingAudioMode();
        // Pass presets explicitly — prepareToRecordAsync() without options drops
        // extension/format on some expo-audio versions (empty/wrong container).
        await audioRecorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
        await audioRecorder.record();
      }
    } catch (err) {
      Alert.alert(
        hi ? "रिकॉर्डिंग विफल" : "Recording failed",
        err instanceof Error
          ? err.message
          : hi
            ? "ऑडियो रिकॉर्ड नहीं हो सका।"
            : "Could not record audio.",
      );
    }
  }

  if (maxUploads <= 0) {
    return (
      <Body muted style={{ marginTop: 12, fontSize: 13 }}>
        {hi ? "इस नियम के लिए मीडिया स्वीकार नहीं है।" : "This niyam does not accept media."}
      </Body>
    );
  }

  const recordingMs = Math.max(
    recordingElapsedMs,
    isRecordingNative ? recorderState.durationMillis ?? 0 : 0,
  );

  return (
    <View style={{ marginTop: 12 }}>
      <Body style={{ marginBottom: 6, fontSize: 13 }}>
        {proofRequired
          ? hi
            ? `प्रमाण * (${value.length}/${maxUploads})`
            : `Proof * (${value.length}/${maxUploads})`
          : hi
            ? `प्रमाण वैकल्पिक (${value.length}/${maxUploads})`
            : `Proof optional (${value.length}/${maxUploads})`}
      </Body>

      {value.map((item) => (
        <Row
          key={item.localId}
          style={{
            marginBottom: 8,
            gap: 10,
            alignItems: "center",
            padding: 8,
            borderWidth: 1,
            borderColor: item.status === "failed" ? c.destructive : c.border,
            borderRadius: c.radius,
          }}
        >
          {item.kind === "photo" && item.previewUri ? (
            <Image source={{ uri: item.previewUri }} style={{ width: 44, height: 44, borderRadius: 6 }} />
          ) : (
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 6,
                backgroundColor: c.muted,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Body style={{ fontSize: 11 }}>{item.kind}</Body>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 13 }}>
              {item.status === "uploading"
                ? hi
                  ? "अपलोड हो रहा है…"
                  : "Uploading…"
                : item.status === "queued"
                  ? // Saved on the device — do NOT say "Ready", which reads as
                    // "already sent" for a file that has not left the phone.
                    hi
                    ? "ऑफ़लाइन सहेजा गया — सिंक होगा"
                    : "Saved offline — will sync"
                  : item.status === "failed"
                    ? item.error ?? (hi ? "विफल" : "Failed")
                    : hi
                      ? "तैयार"
                      : "Ready"}
            </Body>
          </View>
          {item.status === "failed" ? (
            <Pressable onPress={() => void retry(item)} disabled={disabled}>
              <Body style={{ color: c.primary, fontSize: 13 }}>{hi ? "पुनः" : "Retry"}</Body>
            </Pressable>
          ) : null}
          <Pressable onPress={() => remove(item.localId)} disabled={disabled || item.status === "uploading"}>
            <Body style={{ color: c.destructive, fontSize: 13 }}>{hi ? "हटाएँ" : "Remove"}</Body>
          </Pressable>
        </Row>
      ))}

      {isRecording ? (
        <View
          style={{
            marginBottom: 10,
            padding: 12,
            borderWidth: 1,
            borderColor: c.primary,
            borderRadius: c.radius,
            backgroundColor: c.muted,
          }}
        >
          <Body style={{ fontSize: 22, fontVariant: ["tabular-nums"] }}>{formatMs(recordingMs)}</Body>
          <Body muted style={{ marginTop: 4, fontSize: 12 }}>
            {hi ? "रिकॉर्डिंग जारी है…" : "Recording…"}
          </Body>
        </View>
      ) : null}

      {pendingAudio && !isRecording ? (
        <View
          style={{
            marginBottom: 10,
            padding: 12,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: c.radius,
          }}
        >
          <Body style={{ fontSize: 14, marginBottom: 8 }}>
            {hi ? "रिकॉर्डिंग तैयार — सुनकर जोड़ें" : "Recording ready — preview, then add"}
          </Body>
          <Body muted style={{ fontSize: 12, marginBottom: 10 }}>
            {previewStatus.playing
              ? hi
                ? `चल रहा है ${formatMs((previewStatus.currentTime ?? 0) * 1000)}`
                : `Playing ${formatMs((previewStatus.currentTime ?? 0) * 1000)}`
              : hi
                ? "सबमिट से पहले सुनें"
                : "Listen before submitting"}
          </Body>
          <Row style={{ gap: 8, flexWrap: "wrap" }}>
            <Button
              label={previewStatus.playing ? (hi ? "रोकें" : "Pause") : hi ? "सुनें" : "Play"}
              variant="outline"
              onPress={() => void playPendingAudio()}
              style={{ minWidth: 96 }}
            />
            <Button
              label={hi ? "जोड़ें" : "Add"}
              onPress={() => void keepPendingAudio()}
              style={{ minWidth: 96 }}
            />
            <Button
              label={hi ? "हटाएँ" : "Discard"}
              variant="outline"
              onPress={discardPendingAudio}
              style={{ minWidth: 96 }}
            />
          </Row>
        </View>
      ) : null}

      {isRecording ? (
        <Row style={{ marginTop: 4 }}>
          <Button
            label={hi ? "रोकें" : "Stop"}
            onPress={() => void toggleRecord()}
            style={{ minWidth: 120 }}
          />
        </Row>
      ) : null}

      {!atCap && !disabled && !pendingAudio && !isRecording ? (
        <Row style={{ gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          {kinds.includes("photo") ? (
            <>
              <Button
                label={hi ? "कैमरा" : "Camera"}
                variant="outline"
                onPress={() => void captureCamera("photo")}
                style={{ minWidth: 96 }}
              />
              <Button
                label={hi ? "फोटो" : "Library"}
                variant="outline"
                onPress={() => void pickFromLibrary("images")}
                style={{ minWidth: 96 }}
              />
            </>
          ) : null}
          {kinds.includes("video") ? (
            <>
              <Button
                label={hi ? "वीडियो कैम" : "Video cam"}
                variant="outline"
                onPress={() => void captureCamera("video")}
                style={{ minWidth: 96 }}
              />
              <Button
                label={hi ? "वीडियो" : "Video lib"}
                variant="outline"
                onPress={() => void pickFromLibrary("videos")}
                style={{ minWidth: 96 }}
              />
            </>
          ) : null}
          {kinds.includes("audio") ? (
            <Button
              label={hi ? "ऑडियो रिकॉर्ड" : "Record audio"}
              variant="outline"
              onPress={() => void toggleRecord()}
              style={{ minWidth: 120 }}
            />
          ) : null}
        </Row>
      ) : null}
      {kinds.includes("audio") && !audioReady && Platform.OS !== "web" ? (
        <Body muted style={{ marginTop: 8, fontSize: 12 }}>
          {hi
            ? "माइक अनुमति अभी नहीं मिली — रिकॉर्ड पर टैप कर अनुमति दें।"
            : "Mic permission not granted yet — tap Record to allow access."}
        </Body>
      ) : null}
    </View>
  );
}

