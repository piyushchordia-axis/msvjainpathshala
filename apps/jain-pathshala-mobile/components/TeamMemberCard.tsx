import { Image } from "expo-image";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useColors } from "@/hooks/useColors";
import { resolveUploadUrl } from "@/lib/api";
import { displayFamily, fonts } from "@/constants/typography";
import { Body, Card } from "@/components/ui";

export type TeamCardModel = {
  id: string;
  honorific: string | null;
  name_en: string;
  name_hi: string;
  designation_en: string | null;
  designation_hi: string | null;
  photo_asset_id: string | null;
  photo_url: string | null;
  centre_names?: string[];
};

/** Initials from a display name (Latin or Devanagari). */
export function teamInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = [...parts[0]!][0] ?? "";
  if (parts.length === 1) {
    const second = [...parts[0]!][1] ?? "";
    return (first + second).toUpperCase() || "?";
  }
  const last = [...parts[parts.length - 1]!][0] ?? "";
  return (first + last).toUpperCase() || "?";
}

function teamPhotoSrc(photoUrl: string | null | undefined): string | null {
  if (!photoUrl) return null;
  if (photoUrl.includes("/thumb_md/") || photoUrl.includes("_thumb_md")) {
    return resolveUploadUrl(photoUrl);
  }
  if (photoUrl.includes("/original/")) {
    return resolveUploadUrl(photoUrl.replace("/original/", "/thumb_md/"));
  }
  return resolveUploadUrl(photoUrl);
}

type TeamMemberCardProps = {
  member: TeamCardModel;
  hi: boolean;
  variant?: "default" | "core";
  style?: StyleProp<ViewStyle>;
};

/**
 * Public Team card — photo or cream-on-saffron initials.
 * Never shows phone, email, gender, or dob.
 */
export function TeamMemberCard({
  member,
  hi,
  variant = "default",
  style,
}: TeamMemberCardProps) {
  const c = useColors();
  const name = hi ? member.name_hi : member.name_en;
  const designation = hi ? member.designation_hi : member.designation_en;
  const honorific = member.honorific?.trim() || null;
  const centreLabel =
    member.centre_names && member.centre_names.length > 0
      ? member.centre_names.join(" · ")
      : null;
  const src = teamPhotoSrc(member.photo_url);
  const initials = teamInitials(name);
  const isCore = variant === "core";

  return (
    <Card
      style={[
        {
          padding: isCore ? 16 : 0,
          overflow: "hidden",
          flex: 1,
          alignItems: isCore ? "center" : undefined,
          backgroundColor: isCore ? c.creamDark : c.card,
        },
        style,
      ]}
    >
      <View
        style={
          isCore
            ? { width: "100%", maxWidth: 148, aspectRatio: 1 }
            : { aspectRatio: 1, backgroundColor: c.muted, width: "100%" }
        }
      >
        <View
          style={{
            flex: 1,
            overflow: "hidden",
            borderRadius: isCore ? 9999 : 0,
            backgroundColor: c.muted,
          }}
        >
          {src ? (
            <Image
              source={{ uri: src }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              contentPosition="top"
              cachePolicy="memory-disk"
              recyclingKey={member.id}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: c.saffron,
              }}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Text
                style={{
                  fontFamily: fonts.display,
                  fontSize: 28,
                  color: c.cream,
                  letterSpacing: 1,
                }}
              >
                {initials}
              </Text>
            </View>
          )}
        </View>
      </View>
      <View
        style={{
          padding: isCore ? 0 : 14,
          paddingTop: isCore ? 12 : 14,
          gap: 4,
          minHeight: isCore ? undefined : 88,
          alignItems: isCore ? "center" : undefined,
          width: "100%",
        }}
      >
        <Text
          style={{
            fontFamily: displayFamily(hi),
            fontSize: 16,
            color: c.secondary,
            lineHeight: 22,
            textAlign: isCore ? "center" : "left",
          }}
          numberOfLines={2}
        >
          {honorific ? (
            <Text style={{ color: c.mutedForeground }}>{honorific} </Text>
          ) : null}
          {name}
        </Text>
        {designation ? (
          <Body
            muted
            style={{
              fontSize: 13,
              lineHeight: 20,
              textAlign: isCore ? "center" : "left",
            }}
            numberOfLines={2}
          >
            {designation}
          </Body>
        ) : null}
        {!isCore && centreLabel ? (
          <Body muted style={{ fontSize: 12, lineHeight: 18, marginTop: 2 }} numberOfLines={2}>
            {centreLabel}
          </Body>
        ) : null}
      </View>
    </Card>
  );
}
