import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { apiUpload, ApiError } from "@/lib/api";
import { useSetUserPhoto } from "@/lib/queries";

type Options = {
  pickerTitle?: string;
  onSuccess?: () => void | Promise<void>;
};

/**
 * Camera/library → upload to user-photos → PUT /v1/me/photo → persist session user.
 */
export function useUserPhotoPicker(options: Options = {}) {
  const { hi } = useLocale();
  const { updateUser } = useAuth();
  const setPhoto = useSetUserPhoto();
  const [uploading, setUploading] = useState(false);
  const { pickerTitle, onSuccess } = options;

  const busy = uploading || setPhoto.isPending;

  const pickAndUpload = useCallback(
    async (from: "camera" | "library") => {
      if (uploading || setPhoto.isPending) return;

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
              aspect: [1, 1],
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              quality: 0.85,
              allowsEditing: true,
              aspect: [1, 1],
            });

      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const mime = (asset.mimeType ?? "image/jpeg").split(";")[0]!.trim();
      const name = asset.fileName ?? "photo.jpg";

      setUploading(true);
      try {
        const uploaded = await apiUpload(
          { uri: asset.uri, name, type: mime.startsWith("image/") ? mime : "image/jpeg" },
          "user-photos",
        );
        const res = await setPhoto.mutateAsync(uploaded.url);
        if (res?.user) await updateUser(res.user);
        try {
          await Image.clearMemoryCache();
          await Image.clearDiskCache();
        } catch {
          /* best-effort cache bust */
        }
        await onSuccess?.();
        Alert.alert(
          hi ? "फोटो सहेजी गई" : "Photo saved",
          hi ? "आपकी प्रोफ़ाइल फोटो अपडेट हो गई है।" : "Your profile photo was updated.",
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
    [uploading, setPhoto, hi, updateUser, onSuccess],
  );

  const promptPick = useCallback(() => {
    if (busy) return;
    Alert.alert(
      pickerTitle ?? (hi ? "प्रोफ़ाइल फोटो" : "Profile photo"),
      hi ? "फोटो कहाँ से जोड़ें?" : "Where should we take the photo from?",
      [
        { text: hi ? "कैमरा" : "Camera", onPress: () => void pickAndUpload("camera") },
        { text: hi ? "गैलरी" : "Library", onPress: () => void pickAndUpload("library") },
        { text: hi ? "रद्द करें" : "Cancel", style: "cancel" },
      ],
    );
  }, [busy, hi, pickAndUpload, pickerTitle]);

  return { busy, promptPick, pickAndUpload };
}
