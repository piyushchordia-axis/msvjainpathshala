import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { apiUpload, ApiError } from "@/lib/api";
import { useSetStudentPhoto } from "@/lib/queries";

type Options = {
  /** Alert title for the camera/library chooser. */
  pickerTitle?: string;
  /** Called after a successful upload (e.g. refetch ID card art). */
  onSuccess?: () => void | Promise<void>;
};

/**
 * Shared camera/library → upload → set-photo flow for student profile + ID card.
 * Invalidates children via `useSetStudentPhoto` so header avatars refresh.
 */
export function useStudentPhotoPicker(
  studentId: string | null | undefined,
  options: Options = {},
) {
  const { hi } = useLocale();
  const { refetch } = useSessionView();
  const setPhoto = useSetStudentPhoto();
  const [uploading, setUploading] = useState(false);
  const { pickerTitle, onSuccess } = options;

  const busy = uploading || setPhoto.isPending;

  const pickAndUpload = useCallback(
    async (from: "camera" | "library") => {
      if (!studentId || uploading || setPhoto.isPending) return;

      if (from === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(
            hi ? "अनुमति आवश्यक" : "Permission needed",
            hi ? "कैमरा अनुमति दें।" : "Please allow camera access.",
          );
          return;
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(
            hi ? "अनुमति आवश्यक" : "Permission needed",
            hi ? "फोटो लाइब्रेरी की अनुमति दें।" : "Please allow photo library access.",
          );
          return;
        }
      }

      const result =
        from === "camera"
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ["images"],
              quality: 0.85,
              allowsEditing: true,
              aspect: [3, 4],
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              quality: 0.85,
              allowsEditing: true,
              aspect: [3, 4],
            });

      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const mime = (asset.mimeType ?? "image/jpeg").split(";")[0]!.trim();
      const name = asset.fileName ?? "photo.jpg";

      setUploading(true);
      try {
        const uploaded = await apiUpload(
          { uri: asset.uri, name, type: mime.startsWith("image/") ? mime : "image/jpeg" },
          "student-photos",
        );
        await setPhoto.mutateAsync({ studentId, photo_url: uploaded.url });
        try {
          await Image.clearMemoryCache();
          await Image.clearDiskCache();
        } catch {
          /* best-effort cache bust */
        }
        await Promise.all([refetch(), onSuccess?.()]);
        Alert.alert(
          hi ? "फोटो सहेजी गई" : "Photo saved",
          hi
            ? "आपकी फोटो प्रोफ़ाइल और पहचान पत्र पर अपडेट हो गई है।"
            : "Your photo was updated on your profile and ID card.",
        );
      } catch (err) {
        Alert.alert(
          hi ? "फोटो अपडेट नहीं हुई" : "Could not update photo",
          err instanceof ApiError
            ? err.message
            : hi
              ? "कृपया पुनः प्रयास करें।"
              : "Please try again.",
        );
      } finally {
        setUploading(false);
      }
    },
    [studentId, uploading, setPhoto, hi, refetch, onSuccess],
  );

  const promptPick = useCallback(() => {
    if (!studentId || busy) return;
    Alert.alert(
      pickerTitle ?? (hi ? "प्रोफ़ाइल फोटो" : "Profile photo"),
      hi ? "फोटो कहाँ से जोड़ें?" : "Where should we take the photo from?",
      [
        { text: hi ? "कैमरा" : "Camera", onPress: () => void pickAndUpload("camera") },
        { text: hi ? "गैलरी" : "Library", onPress: () => void pickAndUpload("library") },
        { text: hi ? "रद्द करें" : "Cancel", style: "cancel" },
      ],
    );
  }, [studentId, busy, hi, pickAndUpload, pickerTitle]);

  return { busy, promptPick, pickAndUpload };
}
