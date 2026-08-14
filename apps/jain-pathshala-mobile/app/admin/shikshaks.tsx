import { useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { bodyFamily } from "@/constants/typography";
import {
  useAdminBatches,
  useAdminCentres,
  useAssignBatchShikshak,
  useAssignCentreShikshak,
  useCentreShikshaks,
  useRemoveBatchShikshak,
  useRemoveCentreShikshak,
  useSetBatchPrimary,
  useUsersPick,
  wrongRoleMessage,
  type CentreShikshakRow,
} from "@/lib/queries";
import { AppHeader } from "@/components/AppHeader";
import { CentreSwitcher, usePersistedCentreId } from "@/components/CentreSwitcher";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

const CENTRE_KEY = "jp.sanchalak.selectedCentreId";

function honorific(gender: string | null | undefined, hi: boolean): string {
  if (gender === "female") return hi ? "दीदी" : "Didi";
  return hi ? "गुरुजी" : "Guruji";
}

function displayName(row: { full_name: string; gender: string | null }, hi: boolean): string {
  return `${honorific(row.gender, hi)} ${row.full_name}`;
}

function PickSheet({
  open,
  onClose,
  title,
  items,
  busy,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  items: { id: string; label: string; sub?: string }[];
  busy: boolean;
  onPick: (id: string) => void;
}) {
  const c = useColors();
  const { hi } = useLocale();

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ActivityThemed accent="shikshaks">
        <View
          style={{
            paddingHorizontal: 18,
            paddingTop: 18,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Title style={{ fontSize: 18, lineHeight: 26, flex: 1, paddingRight: 12 }}>{title}</Title>
          <Pressable onPress={onClose} hitSlop={12} disabled={busy}>
            <Text style={{ color: c.primary, fontFamily: bodyFamily(hi, "semibold") }}>
              {hi ? "बंद करें" : "Close"}
            </Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 18, gap: 10, paddingBottom: 40 }}>
          {items.length === 0 ? (
            <StateView
              status="empty"
              emptyText={hi ? "कोई उपलब्ध गुरुजी नहीं।" : "No Gurujis available to assign."}
            />
          ) : (
            items.map((item) => (
              <Pressable
                key={item.id}
                disabled={busy}
                onPress={() => onPick(item.id)}
                style={{
                  backgroundColor: c.card,
                  borderRadius: c.radius ?? 12,
                  padding: 14,
                  borderWidth: 1,
                  borderColor: c.border,
                }}
              >
                <Text
                  style={{
                    fontFamily: bodyFamily(hi, "semibold"),
                    fontSize: 16,
                    lineHeight: 24,
                    color: c.foreground,
                  }}
                >
                  {item.label}
                </Text>
                {item.sub ? (
                  <Text
                    style={{
                      fontFamily: bodyFamily(hi),
                      fontSize: 13,
                      lineHeight: 22,
                      color: c.mutedForeground,
                      marginTop: 2,
                    }}
                  >
                    {item.sub}
                  </Text>
                ) : null}
              </Pressable>
            ))
          )}
        </ScrollView>
      </ActivityThemed>
    </Modal>
  );
}

function BatchStaffSection({
  batchId,
  batchName,
  centreShikshaks,
  hi,
}: {
  batchId: string;
  batchName: string;
  centreShikshaks: CentreShikshakRow[];
  hi: boolean;
}) {
  const assignBatch = useAssignBatchShikshak();
  const removeBatch = useRemoveBatchShikshak();
  const setPrimary = useSetBatchPrimary();
  const [pickOpen, setPickOpen] = useState(false);

  const assignedIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of centreShikshaks) {
      if (s.batches.some((b) => b.batch_id === batchId)) set.add(s.user_id);
    }
    return set;
  }, [centreShikshaks, batchId]);

  const onBatch = centreShikshaks.filter((s) => assignedIds.has(s.user_id));
  const candidates = centreShikshaks
    .filter((s) => !assignedIds.has(s.user_id))
    .map((s) => ({
      id: s.user_id,
      label: displayName(s, hi),
      sub: s.phone,
    }));

  function alertErr(e: unknown) {
    Alert.alert(hi ? "त्रुटि" : "Error", wrongRoleMessage(e, hi));
  }

  return (
    <Card>
      <Title style={{ fontSize: 15, lineHeight: 22 }}>{batchName}</Title>
      {onBatch.length === 0 ? (
        <Body muted style={{ marginTop: 6, lineHeight: 22 }}>
          {hi ? "कोई गुरुजी नियुक्त नहीं।" : "No Guruji on this batch yet."}
        </Body>
      ) : (
        onBatch.map((s) => {
          const primary = s.batches.find((b) => b.batch_id === batchId)?.is_primary;
          return (
            <View key={s.user_id} style={{ marginTop: 10 }}>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Body style={{ lineHeight: 22 }}>{displayName(s, hi)}</Body>
                  {primary ? (
                    <View style={{ marginTop: 4 }}>
                      <Pill tone="info" label={hi ? "प्राथमिक" : "Primary"} />
                    </View>
                  ) : null}
                </View>
              </Row>
              <Row style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                {!primary ? (
                  <Button
                    label={hi ? "प्राथमिक बनाएँ" : "Set primary"}
                    variant="outline"
                    loading={setPrimary.isPending && setPrimary.variables?.userId === s.user_id}
                    onPress={() =>
                      setPrimary.mutate(
                        { batchId, userId: s.user_id },
                        { onError: alertErr },
                      )
                    }
                  />
                ) : null}
                <Button
                  label={hi ? "हटाएँ" : "Remove"}
                  variant="ghost"
                  loading={removeBatch.isPending && removeBatch.variables?.userId === s.user_id}
                  onPress={() =>
                    Alert.alert(
                      hi ? "बैच से हटाएँ?" : "Remove from batch?",
                      hi
                        ? `${displayName(s, hi)} को इस बैच से हटा दिया जाएगा।`
                        : `${displayName(s, hi)} will be removed from this batch.`,
                      [
                        { text: hi ? "रद्द" : "Cancel", style: "cancel" },
                        {
                          text: hi ? "हटाएँ" : "Remove",
                          style: "destructive",
                          onPress: () =>
                            removeBatch.mutate(
                              { batchId, userId: s.user_id },
                              { onError: alertErr },
                            ),
                        },
                      ],
                    )
                  }
                />
              </Row>
            </View>
          );
        })
      )}
      <Button
        label={hi ? "गुरुजी जोड़ें" : "Assign Guruji"}
        variant="secondary"
        style={{ marginTop: 12 }}
        onPress={() => setPickOpen(true)}
      />
      <PickSheet
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        title={hi ? "बैच के लिए गुरुजी चुनें" : "Choose a Guruji for this batch"}
        items={candidates}
        busy={assignBatch.isPending}
        onPick={(userId) => {
          assignBatch.mutate(
            { batchId, userId },
            {
              onSuccess: () => setPickOpen(false),
              onError: alertErr,
            },
          );
        }}
      />
    </Card>
  );
}

export default function ShikshaksScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const centresQ = useAdminCentres();
  const centres = useMemo(
    () =>
      (centresQ.data?.items ?? []).map((x) => ({
        centre_id: x.id,
        centre_name: x.name,
      })),
    [centresQ.data?.items],
  );
  const [selectedCentreId, pickCentre] = usePersistedCentreId(centres, CENTRE_KEY);
  const shikshaksQ = useCentreShikshaks(selectedCentreId);
  const batchesQ = useAdminBatches();
  const pickQ = useUsersPick("shikshak", selectedCentreId, !!selectedCentreId);
  const assignCentre = useAssignCentreShikshak();
  const removeCentre = useRemoveCentreShikshak();
  const [pickOpen, setPickOpen] = useState(false);

  const centreBatches = useMemo(() => {
    const all = batchesQ.data?.items ?? [];
    if (!selectedCentreId) return [];
    return all.filter((b) => b.centre_id === selectedCentreId && b.status === "active");
  }, [batchesQ.data?.items, selectedCentreId]);

  const items = shikshaksQ.data?.items ?? [];

  function alertErr(e: unknown) {
    Alert.alert(hi ? "त्रुटि" : "Error", wrongRoleMessage(e, hi));
  }

  const pickItems = (pickQ.data?.items ?? []).map((u) => ({
    id: u.id,
    label: displayName(u, hi),
    sub: u.phone,
  }));

  const refreshing =
    centresQ.isRefetching || shikshaksQ.isRefetching || batchesQ.isRefetching;

  return (
    <ActivityThemed accent="shikshaks">
      <AppHeader
        title={hi ? "शिक्षक" : "Shikshaks"}
        subtitle={hi ? "केंद्र और बैच नियुक्तियाँ" : "Centre and batch assignments"}
        showBack
        backHref="/admin/dashboard"
      />
      <Screen
        refreshing={refreshing}
        onRefresh={() => {
          void centresQ.refetch();
          void shikshaksQ.refetch();
          void batchesQ.refetch();
        }}
      >
        <CentreSwitcher
          centres={centres}
          storageKey={CENTRE_KEY}
          selectedId={selectedCentreId}
          onChange={pickCentre}
        />

        {centresQ.isLoading || shikshaksQ.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : centresQ.isError || shikshaksQ.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "शिक्षक लोड नहीं हुए।" : "Could not load Shikshaks."}
            onRetry={() => {
              void centresQ.refetch();
              void shikshaksQ.refetch();
            }}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : !selectedCentreId ? (
          <StateView
            status="empty"
            emptyText={hi ? "कोई केंद्र नहीं मिला।" : "No centres found."}
          />
        ) : (
          <>
            <Row style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <Title style={{ fontSize: 16, lineHeight: 24 }}>
                {hi ? "केंद्र पर नियुक्त" : "Assigned to centre"}
              </Title>
              <Button
                label={hi ? "नियुक्त करें" : "Assign"}
                variant="secondary"
                onPress={() => setPickOpen(true)}
              />
            </Row>

            {items.length === 0 ? (
              <StateView
                status="empty"
                emptyText={
                  hi
                    ? "इस केंद्र पर कोई गुरुजी नहीं।"
                    : "No Guruji tagged to this centre yet."
                }
              />
            ) : (
              items.map((s) => (
                <Card key={s.id}>
                  <Title style={{ fontSize: 17, lineHeight: 24 }}>
                    {displayName(s, hi)}
                  </Title>
                  <Body muted style={{ marginTop: 4, lineHeight: 22 }}>
                    {s.phone}
                    {s.gender
                      ? ` · ${s.gender === "female" ? (hi ? "महिला" : "Female") : hi ? "पुरुष" : "Male"}`
                      : ""}
                  </Body>
                  {s.batches.length > 0 ? (
                    <Body muted style={{ marginTop: 8, fontSize: 13, lineHeight: 22 }}>
                      {hi ? "बैच: " : "Batches: "}
                      {s.batches
                        .map((b) =>
                          b.is_primary ? `${b.batch_name} (${hi ? "प्राथमिक" : "primary"})` : b.batch_name,
                        )
                        .join(", ")}
                    </Body>
                  ) : (
                    <Body muted style={{ marginTop: 8, fontSize: 13, lineHeight: 22 }}>
                      {hi ? "कोई बैच नहीं।" : "No batches yet."}
                    </Body>
                  )}
                  <Button
                    label={hi ? "केंद्र से हटाएँ" : "Remove from centre"}
                    variant="outline"
                    style={{ marginTop: 12 }}
                    loading={
                      removeCentre.isPending && removeCentre.variables?.userId === s.user_id
                    }
                    onPress={() =>
                      Alert.alert(
                        hi ? "केंद्र से हटाएँ?" : "Remove from centre?",
                        hi
                          ? `${displayName(s, hi)} और उनके बैच असाइनमेंट हटा दिए जाएँगे।`
                          : `${displayName(s, hi)} and their batch assignments at this centre will be removed.`,
                        [
                          { text: hi ? "रद्द" : "Cancel", style: "cancel" },
                          {
                            text: hi ? "हटाएँ" : "Remove",
                            style: "destructive",
                            onPress: () =>
                              removeCentre.mutate(
                                { centreId: selectedCentreId, userId: s.user_id },
                                { onError: alertErr },
                              ),
                          },
                        ],
                      )
                    }
                  />
                </Card>
              ))
            )}

            <Title style={{ fontSize: 16, marginTop: 16, marginBottom: 8, lineHeight: 24 }}>
              {hi ? "बैच नियुक्तियाँ" : "Batch assignments"}
            </Title>
            {centreBatches.length === 0 ? (
              <StateView
                status="empty"
                emptyText={hi ? "इस केंद्र पर कोई सक्रिय बैच नहीं।" : "No active batches at this centre."}
              />
            ) : (
              centreBatches.map((b) => (
                <BatchStaffSection
                  key={b.id}
                  batchId={b.id}
                  batchName={b.name ?? (hi ? "बैच" : "Batch")}
                  centreShikshaks={items}
                  hi={hi}
                />
              ))
            )}
          </>
        )}
      </Screen>

      <PickSheet
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        title={hi ? "गुरुजी चुनें" : "Choose a Guruji"}
        items={pickItems}
        busy={assignCentre.isPending}
        onPick={(userId) => {
          if (!selectedCentreId) return;
          assignCentre.mutate(
            { centreId: selectedCentreId, userId },
            {
              onSuccess: () => {
                setPickOpen(false);
                void pickQ.refetch();
              },
              onError: alertErr,
            },
          );
        }}
      />
    </ActivityThemed>
  );
}
