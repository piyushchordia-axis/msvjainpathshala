/**
 * Sanchalak gallery moderation — hide / take down only (no featuring).
 *
 * Phone-specific safeguards for opted-out family photos (Q6):
 * 1. Unmissable opt-out badge on the thumbnail itself
 * 2. cachePolicy="memory" on thumbnails (expo-image RAM-only — no disk; required for opted-out)
 * 3. Query key never dehydrates to AsyncStorage (query-persist-keys)
 * 4. Default filter = Needs attention (public + last 14 days)
 * 5. No share / save / long-press image menu
 */
import { useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type ListRenderItem,
  type NativeSyntheticEvent,
  type NativeTouchEvent,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { resolveUploadUrl, ApiError } from "@/lib/api";
import { bodyFamily } from "@/constants/typography";
import { formatDate } from "@/lib/format";
import {
  useAdminGalleryInfinite,
  useGalleryTakedown,
  useGalleryVisibility,
  type AdminGalleryFilter,
  type AdminGalleryItem,
} from "@/lib/queries";
import { AppHeader } from "@/components/AppHeader";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { Body, Button, Card, Pill, Row, StateView, Title } from "@/components/ui";

const FILTERS: { id: AdminGalleryFilter; en: string; hi: string }[] = [
  { id: "needs_attention", en: "Needs attention", hi: "ध्यान दें" },
  { id: "all", en: "All", hi: "सभी" },
  { id: "hidden", en: "Hidden", hi: "छिपे" },
  { id: "opted_out", en: "Opted out", hi: "सहमति नहीं" },
];

function isOptedOut(item: AdminGalleryItem): boolean {
  return !!item.student_id && item.consent_opt_in === false;
}

function blockContextMenu(e: NativeSyntheticEvent<NativeTouchEvent>) {
  // Web: kill right-click / long-press save menus on the thumbnail.
  const native = e.nativeEvent as unknown as { preventDefault?: () => void };
  native.preventDefault?.();
}

function TakedownModal({
  item,
  open,
  onClose,
  onConfirm,
  busy,
}: {
  item: AdminGalleryItem | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  busy: boolean;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ActivityThemed accent="gallery">
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 40 }}
          bottomOffset={20}
          keyboardShouldPersistTaps="handled"
        >
          <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
            <Title style={{ fontSize: 20 }}>{hi ? "फोटो हटाएँ" : "Take down"}</Title>
            <Pressable onPress={onClose} hitSlop={12} disabled={busy}>
              <Ionicons name="close" size={24} color={c.foreground} />
            </Pressable>
          </Row>
          <Body muted style={{ lineHeight: 22 }}>
            {hi
              ? "यह फोटो गैलरी से हट जाएगा। ऑडिट लॉग के लिए संक्षिप्त कारण लिखें (कम से कम 5 अक्षर)।"
              : "This photo will be removed from the gallery. Write a short reason for the audit log (at least 5 characters)."}
          </Body>
          {item?.first_name ? (
            <Body style={{ lineHeight: 22 }}>
              {hi ? "विद्यार्थी" : "Student"}: {item.first_name}
            </Body>
          ) : null}
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder={hi ? "कारण लिखें…" : "Reason…"}
            placeholderTextColor={c.mutedForeground}
            multiline
            maxLength={500}
            editable={!busy}
            style={{
              fontFamily: bodyFamily(hi),
              fontSize: 15,
              lineHeight: 22,
              color: c.foreground,
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: c.radius,
              padding: 12,
              minHeight: 96,
              textAlignVertical: "top",
              backgroundColor: c.card,
            }}
          />
          <Button
            label={hi ? "हटाएँ" : "Take down"}
            icon="trash-outline"
            loading={busy}
            disabled={trimmed.length < 5 || busy}
            onPress={() => onConfirm(trimmed)}
          />
          <Button label={hi ? "रद्द करें" : "Cancel"} variant="ghost" onPress={onClose} disabled={busy} />
        </KeyboardAwareScrollViewCompat>
      </ActivityThemed>
    </Modal>
  );
}

function GalleryCard({
  item,
  busy,
  onHideToggle,
  onTakedown,
}: {
  item: AdminGalleryItem;
  busy: boolean;
  onHideToggle: () => void;
  onTakedown: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const optedOut = isOptedOut(item);
  const uri = resolveUploadUrl(item.thumbnail_url ?? item.image_url);
  const caption = (hi ? item.caption_hi : item.caption) || item.caption;

  return (
    <Card style={{ padding: 0, overflow: "hidden", marginBottom: 12 }}>
      <View style={{ position: "relative", backgroundColor: c.muted, aspectRatio: 4 / 3 }}>
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            // This screen never writes thumbnails to disk — shared-device safeguard.
            // ("memory" is expo-image's RAM-only policy; there is no "memory-only" literal.)
            cachePolicy="memory"
            recyclingKey={item.id}
            accessible={false}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 28, color: c.mutedForeground }}>
              {(item.first_name || "G").slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}

        {/* Absorb long-press so the OS never offers Save / Share on the photo. */}
        <Pressable
          style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
          onLongPress={() => undefined}
          delayLongPress={200}
          {...(Platform.OS === "web"
            ? ({ onContextMenu: blockContextMenu } as object)
            : {})}
        />

        {optedOut ? (
          <View
            style={{
              position: "absolute",
              left: 8,
              right: 8,
              bottom: 8,
              backgroundColor: c.secondary,
              borderRadius: c.radius ?? 12,
              paddingHorizontal: 10,
              paddingVertical: 8,
            }}
          >
            <Text
              style={{
                fontFamily: bodyFamily(hi, "semibold"),
                fontSize: 13,
                lineHeight: 22,
                color: c.secondaryForeground,
                textAlign: "center",
              }}
            >
              {hi
                ? "परिवार ने सहमति नहीं दी — सभी से छिपा"
                : "Family opted out — hidden from everyone"}
            </Text>
          </View>
        ) : null}

        <View style={{ position: "absolute", top: 8, left: 8, flexDirection: "row", gap: 6 }}>
          {!item.is_public ? (
            <Pill tone="neutral" label={hi ? "छिपा" : "Hidden"} />
          ) : (
            <Pill tone="info" label={hi ? "सार्वजनिक" : "Public"} />
          )}
        </View>
      </View>

      <View style={{ padding: 12, gap: 8 }}>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Title style={{ fontSize: 16, lineHeight: 22 }}>
              {item.first_name || (hi ? "सामान्य फोटो" : "General photo")}
            </Title>
            <Body muted style={{ fontSize: 12, lineHeight: 22, marginTop: 2 }}>
              {[item.centre_name, formatDate(item.created_at)].filter(Boolean).join(" · ")}
            </Body>
          </View>
        </Row>
        {caption ? (
          <Body style={{ fontSize: 13, lineHeight: 22 }} numberOfLines={3}>
            {caption}
          </Body>
        ) : null}
        {item.niyam_title_en ? (
          <Body muted style={{ fontSize: 12, lineHeight: 22 }}>
            {item.niyam_title_en}
          </Body>
        ) : null}

        <Row style={{ gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <Button
            label={item.is_public ? (hi ? "छिपाएँ" : "Hide") : hi ? "दिखाएँ" : "Unhide"}
            variant="outline"
            icon={item.is_public ? "eye-off-outline" : "eye-outline"}
            disabled={busy}
            onPress={onHideToggle}
            style={{ minWidth: 110 }}
          />
          <Button
            label={hi ? "हटाएँ" : "Take down"}
            variant="outline"
            icon="trash-outline"
            disabled={busy}
            onPress={onTakedown}
            style={{ minWidth: 110 }}
          />
        </Row>
      </View>
    </Card>
  );
}

export default function AdminGalleryScreen() {
  const c = useColors();
  const { hi } = useLocale();
  // Safeguard 4 — proactive browsing of every photo must be deliberate.
  const [filter, setFilter] = useState<AdminGalleryFilter>("needs_attention");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [takedownItem, setTakedownItem] = useState<AdminGalleryItem | null>(null);

  const list = useAdminGalleryInfinite(filter);
  const visibility = useGalleryVisibility();
  const takedown = useGalleryTakedown();

  const items = useMemo(
    () => list.data?.pages.flatMap((p) => p.items) ?? [],
    [list.data?.pages],
  );

  function toggleVisibility(item: AdminGalleryItem) {
    const next = !item.is_public;
    Alert.alert(
      next ? (hi ? "दिखाएँ?" : "Unhide?") : hi ? "छिपाएँ?" : "Hide?",
      next
        ? hi
          ? "यह फोटो फिर सार्वजनिक हो सकता है — परिवार की सहमति भी ज़रूरी है।"
          : "This photo may become public again — family opt-in still applies."
        : hi
          ? "यह फोटो सार्वजनिक गैलरी से छिप जाएगा।"
          : "This photo will be hidden from the public gallery.",
      [
        { text: hi ? "रद्द करें" : "Cancel", style: "cancel" },
        {
          text: next ? (hi ? "दिखाएँ" : "Unhide") : hi ? "छिपाएँ" : "Hide",
          onPress: () => {
            setBusyId(item.id);
            visibility.mutate(
              { id: item.id, is_public: next },
              {
                onError: (err) =>
                  Alert.alert(
                    hi ? "अपडेट नहीं हुआ" : "Could not update",
                    err instanceof ApiError
                      ? err.message
                      : hi
                        ? "कृपया पुनः प्रयास करें।"
                        : "Please try again.",
                  ),
                onSettled: () => setBusyId(null),
              },
            );
          },
        },
      ],
    );
  }

  const renderItem: ListRenderItem<AdminGalleryItem> = ({ item }) => (
    <GalleryCard
      item={item}
      busy={busyId === item.id || takedown.isPending}
      onHideToggle={() => toggleVisibility(item)}
      onTakedown={() => setTakedownItem(item)}
    />
  );

  return (
    <ActivityThemed accent="gallery">
      <AppHeader
        title={hi ? "गैलरी" : "Gallery"}
        subtitle={
          hi
            ? "छिपाएँ या हटाएँ — विशेष दिखाना सिटी एडमिन का काम है"
            : "Hide or take down — featuring stays with city admin"
        }
        showBack
        backHref="/admin/dashboard"
      />

      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <Row style={{ gap: 8, flexWrap: "wrap" }}>
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <Pressable
                key={f.id}
                onPress={() => setFilter(f.id)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: c.radius ?? 12,
                  backgroundColor: active ? c.primary : c.muted,
                }}
              >
                <Text
                  style={{
                    fontFamily: bodyFamily(hi, active ? "semibold" : "regular"),
                    fontSize: 13,
                    lineHeight: 22,
                    color: active ? c.primaryForeground : c.foreground,
                  }}
                >
                  {hi ? f.hi : f.en}
                </Text>
              </Pressable>
            );
          })}
        </Row>
        {filter === "all" ? (
          <Body muted style={{ fontSize: 12, lineHeight: 22, marginTop: 8 }}>
            {hi
              ? "सभी फोटो देखना जानबूझकर चुनें — परिवार की गोपनीयता का ध्यान रखें।"
              : "Browsing every photo is intentional — treat family privacy carefully."}
          </Body>
        ) : null}
      </View>

      {list.isLoading ? (
        <StateView status="loading" emptyText="" />
      ) : list.isError ? (
        <StateView
          status="error"
          emptyText=""
          errorText={hi ? "गैलरी लोड नहीं हुई।" : "Could not load the gallery."}
          onRetry={() => void list.refetch()}
          retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
        />
      ) : items.length === 0 ? (
        <StateView
          status="empty"
          emptyText={
            filter === "needs_attention"
              ? hi
                ? "ध्यान देने योग्य कोई नई सार्वजनिक फोटो नहीं।"
                : "Nothing public and recent needs attention."
              : hi
                ? "इस फ़िल्टर में कोई फोटो नहीं।"
                : "No photos in this filter."
          }
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          refreshing={list.isRefetching}
          onRefresh={() => void list.refetch()}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) {
              void list.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            list.isFetchingNextPage ? (
              <Body muted style={{ textAlign: "center", paddingVertical: 12 }}>
                {hi ? "और लोड हो रहा है…" : "Loading more…"}
              </Body>
            ) : null
          }
        />
      )}

      <TakedownModal
        item={takedownItem}
        open={!!takedownItem}
        busy={takedown.isPending}
        onClose={() => {
          if (!takedown.isPending) setTakedownItem(null);
        }}
        onConfirm={(reason) => {
          if (!takedownItem) return;
          const id = takedownItem.id;
          setBusyId(id);
          takedown.mutate(
            { id, reason },
            {
              onSuccess: () => setTakedownItem(null),
              onError: (err) =>
                Alert.alert(
                  hi ? "हटाया नहीं जा सका" : "Could not take down",
                  err instanceof ApiError
                    ? err.message
                    : hi
                      ? "कृपया पुनः प्रयास करें।"
                      : "Please try again.",
                ),
              onSettled: () => setBusyId(null),
            },
          );
        }}
      />
    </ActivityThemed>
  );
}
