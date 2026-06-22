import { useState } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import { apiPost } from "@/lib/api";

/**
 * In-app account deletion. Required by App Store guideline 5.1.1(v) and Google
 * Play for apps that support account creation: the signed-in user must be able
 * to start account deletion from inside the app. Calls
 * POST /api/auth/delete-account (soft-deletes the account + revokes every
 * device session server-side), then clears the local session and returns to the
 * sign-in screen. Full purge of residual data happens within 30 days per the
 * public /delete-account policy.
 */
export function DeleteAccountButton() {
  const { hi } = useLocale();
  const { logout } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function runDelete() {
    setBusy(true);
    try {
      await apiPost("/api/auth/delete-account", {});
    } catch {
      // Deletion did not go through — keep the user signed in so they can retry.
      setBusy(false);
      Alert.alert(
        hi ? "हटाया नहीं जा सका" : "Couldn't delete account",
        hi
          ? "कृपया पुनः प्रयास करें या support@jainpathshala.enaacreations.com पर संपर्क करें।"
          : "Please try again, or contact support@jainpathshala.enaacreations.com.",
      );
      return;
    }
    // Account is gone server-side; clear the local session (best-effort) and exit.
    await logout();
    router.replace("/");
  }

  function confirm() {
    Alert.alert(
      hi ? "खाता हटाएं?" : "Delete account?",
      hi
        ? "इससे आपका खाता और आपकी जानकारी (प्रोफ़ाइल, उपस्थिति, गृहकार्य, परीक्षा, नियम, ID कार्ड) स्थायी रूप से हटा दी जाएगी। यह वापस नहीं किया जा सकता।"
        : "This permanently deletes your account and your data — profile, attendance, homework, exams, niyams, and ID card. This cannot be undone.",
      [
        { text: hi ? "रद्द करें" : "Cancel", style: "cancel" },
        {
          text: hi ? "हटाएं" : "Delete",
          style: "destructive",
          onPress: () => {
            void runDelete();
          },
        },
      ],
    );
  }

  return (
    <Button
      label={hi ? "खाता हटाएं" : "Delete my account"}
      variant="outline"
      icon="trash-outline"
      loading={busy}
      onPress={confirm}
    />
  );
}
