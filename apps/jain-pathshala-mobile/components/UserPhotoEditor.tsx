import { Text, View } from "react-native";
import { Image } from "expo-image";
import { bodyFamily } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useUserPhotoPicker } from "@/hooks/useUserPhotoPicker";
import { initialsFromName } from "@/components/AppHeader";
import { resolveUploadUrl } from "@/lib/api";
import { Body, Button, Card, Row, Title } from "@/components/ui";

type Props = {
  name: string;
  photoUrl?: string | null;
  helperText?: string;
  pickerTitle?: string;
  onUploadSuccess?: () => void | Promise<void>;
};

/**
 * Circular avatar + Add/Change photo for the logged-in user's profile photo.
 */
export function UserPhotoEditor({
  name,
  photoUrl,
  helperText,
  pickerTitle,
  onUploadSuccess,
}: Props) {
  const c = useColors();
  const { hi } = useLocale();
  const { busy, promptPick } = useUserPhotoPicker({
    pickerTitle,
    onSuccess: onUploadSuccess,
  });
  const uri = resolveUploadUrl(photoUrl);
  const hasPhoto = !!uri;
  const initials = initialsFromName(name);
  const avatarSize = 72;

  const ctaLabel = busy
    ? hi
      ? "सेव हो रहा है…"
      : "Saving…"
    : hasPhoto
      ? hi
        ? "फोटो बदलें"
        : "Change photo"
      : hi
        ? "फोटो जोड़ें"
        : "Add photo";

  const defaultHelper = hi
    ? "यह फोटो ऐप में आपकी प्रोफ़ाइल पर दिखेगी।"
    : "This photo appears on your profile in the app.";

  return (
    <Card>
      <Row style={{ gap: 14, alignItems: "center" }}>
        <View
          style={{
            width: avatarSize,
            height: avatarSize,
            borderRadius: avatarSize / 2,
            overflow: "hidden",
            backgroundColor: c.primary,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: c.border,
          }}
        >
          {uri ? (
            <Image
              source={{ uri }}
              style={{ width: avatarSize, height: avatarSize }}
              contentFit="cover"
            />
          ) : (
            <Text
              style={{
                fontFamily: bodyFamily(false, "semibold"),
                fontSize: avatarSize * 0.34,
                color: c.primaryForeground,
              }}
            >
              {initials}
            </Text>
          )}
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Title style={{ fontSize: 17 }}>{name}</Title>
          <Body muted style={{ marginTop: 4, fontSize: 13 }}>
            {helperText ?? defaultHelper}
          </Body>
          <Row style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
            <Button
              label={ctaLabel}
              variant="primary"
              icon={hasPhoto ? "camera-outline" : "person-add-outline"}
              onPress={promptPick}
              loading={busy}
              disabled={busy}
              style={{ minWidth: 140 }}
            />
          </Row>
        </View>
      </Row>
    </Card>
  );
}
