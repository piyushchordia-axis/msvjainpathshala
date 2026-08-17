import { Text, View } from "react-native";
import { Image } from "expo-image";
import { bodyFamily } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useStudentPhotoPicker } from "@/hooks/useStudentPhotoPicker";
import { initialsFromName } from "@/components/AppHeader";
import { resolveUploadUrl } from "@/lib/api";
import { Body, Button, Card, Row, Title } from "@/components/ui";

type Props = {
  studentId: string;
  name: string;
  photoUrl?: string | null;
  /** Portrait frame for ID card; circular avatar for profile. */
  layout?: "avatar" | "portrait";
  /** Extra helper under the name (defaults to ID-card note). */
  helperText?: string;
  /** When true, CTA uses primary fill so it reads as the main action. */
  primaryCta?: boolean;
  /**
   * `below` — CTA under the name (profile).
   * `end` — CTA to the right of the name (ID card).
   */
  ctaPlacement?: "below" | "end";
  /** Alert title for the camera/library chooser. */
  pickerTitle?: string;
  /** Called after a successful upload. */
  onUploadSuccess?: () => void | Promise<void>;
};

/**
 * Avatar/portrait + Add/Change photo CTA. Shared by profile and ID card screens.
 */
export function StudentPhotoEditor({
  studentId,
  name,
  photoUrl,
  layout = "avatar",
  helperText,
  primaryCta = true,
  ctaPlacement = "below",
  pickerTitle,
  onUploadSuccess,
}: Props) {
  const c = useColors();
  const { hi } = useLocale();
  const { busy, promptPick } = useStudentPhotoPicker(studentId, {
    pickerTitle,
    onSuccess: onUploadSuccess,
  });
  const uri = resolveUploadUrl(photoUrl);
  const hasPhoto = !!uri;
  const initials = initialsFromName(name);

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
    ? "यह फोटो प्रोफ़ाइल और डिजिटल पहचान पत्र पर दिखेगी।"
    : "This photo appears on your profile and digital ID card.";

  const avatarSize = 72;
  const inlineCta = ctaPlacement === "end";

  const ctaButton = (
    <Button
      label={ctaLabel}
      variant={primaryCta ? "primary" : "outline"}
      icon={hasPhoto ? "camera-outline" : "person-add-outline"}
      onPress={promptPick}
      loading={busy}
      disabled={busy}
      // Inline, the button shares a row with the name: full-width padding left
      // the name ~50dp and wrapped it onto a second line, so go compact and let
      // the name have the space.
      compact={inlineCta}
      style={inlineCta ? { flexShrink: 0 } : { minWidth: 140 }}
    />
  );

  return (
    <Card>
      <Row style={{ gap: 14, alignItems: "center" }}>
        {layout === "portrait" ? (
          <View
            style={{
              width: 72,
              height: 92,
              borderRadius: 10,
              overflow: "hidden",
              backgroundColor: c.muted,
              borderWidth: 1,
              borderColor: c.border,
            }}
          >
            {uri ? (
              <Image
                source={{ uri }}
                style={{ width: "100%", height: "100%" }}
                contentFit="cover"
              />
            ) : (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <Body muted style={{ fontSize: 11 }}>
                  {hi ? "फोटो" : "Photo"}
                </Body>
              </View>
            )}
          </View>
        ) : (
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
        )}

        <View style={{ flex: 1, minWidth: 0 }}>
          {inlineCta ? (
            <>
              <Row style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Title style={{ fontSize: 17 }} numberOfLines={1}>
                    {name}
                  </Title>
                </View>
                {ctaButton}
              </Row>
              <Body muted style={{ marginTop: 4, fontSize: 13 }}>
                {helperText ?? defaultHelper}
              </Body>
            </>
          ) : (
            <>
              <Title style={{ fontSize: 17 }}>{name}</Title>
              <Body muted style={{ marginTop: 4, fontSize: 13 }}>
                {helperText ?? defaultHelper}
              </Body>
              <Row style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>{ctaButton}</Row>
            </>
          )}
        </View>
      </Row>
    </Card>
  );
}
