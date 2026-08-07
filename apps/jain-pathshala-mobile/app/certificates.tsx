/**
 * Parent/student course certificates — scoped via ChildSwitcher like Niyam / attendance.
 */
import { Linking, Pressable, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { bodyFamily } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { Body, Card, Screen, StateView, Title } from "@/components/ui";
import { useStudentCertificates } from "@/lib/queries";

export default function CertificatesScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { children, loading, isError, activeStudentId, refetch } = useSessionView();
  const certsQ = useStudentCertificates(activeStudentId ?? undefined, !!activeStudentId);
  const items = certsQ.data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "प्रमाणपत्र" : "Certificates"}
        subtitle={hi ? "प्रमाणित अनुभाग और पाठ्यक्रम" : "Certified sections and courses"}
      />
      <Screen
        refreshing={certsQ.isFetching}
        onRefresh={() => {
          refetch();
          void certsQ.refetch();
        }}
      >
        {loading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "जानकारी लोड नहीं हुई।" : "Could not load your children."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : children.length === 0 ? (
          <StateView
            status="empty"
            emptyText={
              hi
                ? "आपके खाते से कोई बच्चा जुड़ा नहीं है।"
                : "No children linked to your account yet."
            }
          />
        ) : !activeStudentId ? (
          <StateView
            status="empty"
            emptyText={
              hi
                ? "आपकी विद्यार्थी प्रोफ़ाइल अभी तैयार नहीं है।"
                : "Your student profile isn't ready yet."
            }
          />
        ) : (
          <>
            <ChildSwitcher />

            <Title style={{ fontSize: 17, lineHeight: 24, marginTop: 4, marginBottom: 4 }}>
              {hi ? "जारी प्रमाणपत्र" : "Issued certificates"}
            </Title>

            {certsQ.isLoading ? (
              <StateView status="loading" emptyText="" />
            ) : certsQ.isError ? (
              <StateView
                status="error"
                emptyText=""
                errorText={
                  hi
                    ? "प्रमाणपत्र नहीं मिले — फिर कोशिश करें।"
                    : "Could not load certificates — try again."
                }
                onRetry={() => void certsQ.refetch()}
                retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
              />
            ) : items.length === 0 ? (
              <StateView
                status="empty"
                emptyText={
                  hi
                    ? "अभी कोई प्रमाणपत्र नहीं। प्रमाणित अनुभाग यहाँ दिखेंगे।"
                    : "No certificates yet. Certified sections will appear here."
                }
              />
            ) : (
              items.map((row) => (
                <Card key={row.id} style={{ gap: 6 }}>
                  <Text
                    style={{
                      fontSize: 16,
                      lineHeight: 24,
                      fontFamily: bodyFamily(hi, "semibold"),
                      color: c.foreground,
                    }}
                  >
                    {hi ? row.title_hi || row.title_en : row.title_en}
                  </Text>
                  <Body muted style={{ lineHeight: 22 }}>
                    {hi
                      ? row.honorific_hi || "प्रमाणित"
                      : row.honorific_en || "Certified"}
                    {" · "}
                    {new Date(row.issued_at).toLocaleDateString(hi ? "hi-IN" : "en-GB")}
                  </Body>
                  <Body muted style={{ lineHeight: 22, fontSize: 12 }}>
                    {hi ? "सत्यापन कोड" : "Verification code"}: {row.verification_code}
                  </Body>
                  {row.pdf_url ? (
                    <Pressable onPress={() => void Linking.openURL(row.pdf_url!)}>
                      <Body style={{ color: c.primary, lineHeight: 22 }}>
                        {hi ? "PDF खोलें" : "Open PDF"}
                      </Body>
                    </Pressable>
                  ) : (
                    <Body muted style={{ lineHeight: 22, fontSize: 12 }}>
                      {row.status === "issuing"
                        ? hi
                          ? "PDF बन रहा है…"
                          : "PDF is still issuing…"
                        : hi
                          ? "PDF उपलब्ध नहीं"
                          : "PDF not available"}
                    </Body>
                  )}
                </Card>
              ))
            )}
          </>
        )}
      </Screen>
    </View>
  );
}
