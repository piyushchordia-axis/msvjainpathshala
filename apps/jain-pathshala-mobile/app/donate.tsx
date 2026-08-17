/**
 * Donate (guest) — live campaigns + a recorded donation pledge.
 *
 * The mobile "Donate" row used to open a static card whose only action was a
 * mailto: link — no campaigns, no amounts, nothing recorded anywhere
 * (GST-API-03). This screen shows the real public campaigns
 * (GET /v1/donations/campaigns) and records the donor's pledge through
 * POST /v1/enquiries with the server's first-class `donate` kind, so it lands in
 * the admin Enquiries inbox with the donor's contact details for follow-up.
 *
 * Deliberately NOT calling POST /v1/donations/order here: completing a Razorpay
 * order needs the checkout UI, which on mobile requires react-native-webview —
 * not currently a dependency. Creating orders that can never be paid would be
 * worse than a pledge. Decision (2026-08 guest re-review): the pledge flow is
 * the intended mobile behaviour for now — online payment stays on the website.
 * If in-app checkout is ever wanted, this screen is where it slots in.
 */
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { apiGet, apiPost } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error-copy";
import { bodyFamily } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Numeric, Row, Screen, StateView, Title } from "@/components/ui";

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  target_amount_paise: number | null;
  raised_amount_paise: number | null;
};

const PRESETS = [101, 501, 1100, 2100];

function rupees(paise: number | null | undefined): string {
  if (paise == null) return "";
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

export default function DonateScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();

  const campaigns = useQuery({
    queryKey: ["public", "donation-campaigns"],
    queryFn: () => apiGet<{ items: Campaign[] }>("/v1/donations/campaigns"),
  });

  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const items = campaigns.data?.items ?? [];
  const chosenAmount = amount ?? (customAmount ? Number(customAmount) : null);

  const inputStyle = {
    fontFamily: bodyFamily(hi),
    fontSize: 16,
    lineHeight: 22,
    color: c.foreground,
    backgroundColor: c.muted,
    borderRadius: c.radius ?? 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  } as const;

  async function submit() {
    if (!name.trim() || !phone.trim()) {
      setError(
        hi
          ? "कृपया अपना नाम और मोबाइल नंबर लिखें ताकि टीम संपर्क कर सके।"
          : "Please add your name and mobile number so the team can reach you.",
      );
      return;
    }
    if (!chosenAmount || !Number.isFinite(chosenAmount) || chosenAmount < 1) {
      setError(hi ? "कृपया राशि चुनें।" : "Please choose an amount.");
      return;
    }
    setBusy(true);
    setError(null);
    const campaignName = items.find((x) => x.id === campaignId)?.name;
    try {
      await apiPost("/v1/enquiries", {
        kind: "donate",
        name: name.trim(),
        phone: phone.trim(),
        subject: `Donation pledge — ₹${chosenAmount}${campaignName ? ` — ${campaignName}` : ""}`,
        message:
          `Pledged ₹${chosenAmount}` +
          (campaignName ? ` for "${campaignName}"` : " (general donation)") +
          ` via the mobile app. Please contact the donor to complete the payment.`,
      });
      setSent(true);
    } catch (err) {
      setError(apiErrorMessage(err, hi));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <AppHeader title={hi ? "दान करें" : "Donate"} />
        <Screen>
          <Card style={{ marginTop: 20 }}>
            <Title style={{ fontSize: 18 }}>
              {hi ? "धन्यवाद — संकल्प दर्ज हुआ" : "Thank you — your pledge is recorded"}
            </Title>
            <Body muted style={{ marginTop: 8 }}>
              {hi
                ? "हमारी टीम भुगतान पूरा करने के लिए आपसे संपर्क करेगी। भुगतान के बाद रसीद जारी की जाती है।"
                : "Our team will contact you to complete the payment. A receipt is issued after payment."}
            </Body>
            <Button
              label={hi ? "हो गया" : "Done"}
              style={{ marginTop: 16 }}
              onPress={() => router.back()}
            />
          </Card>
        </Screen>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "दान करें" : "Donate"}
        subtitle={hi ? "जैन शिक्षा का समर्थन करें" : "Support Jain education"}
      />
      <Screen scroll>
        {campaigns.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : campaigns.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "अभियान लोड नहीं हो सके।" : "Could not load campaigns."}
            onRetry={() => void campaigns.refetch()}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : (
          <View style={{ gap: 14, marginTop: 8 }}>
            {items.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Body muted style={{ fontSize: 12 }}>
                  {hi ? "अभियान चुनें (वैकल्पिक)" : "Pick a campaign (optional)"}
                </Body>
                {items.map((cp) => {
                  const on = campaignId === cp.id;
                  return (
                    <Pressable key={cp.id} onPress={() => setCampaignId(on ? null : cp.id)}>
                      <Card
                        style={{
                          padding: 14,
                          borderWidth: 1,
                          borderColor: on ? c.primary : c.border,
                        }}
                      >
                        <Title style={{ fontSize: 15 }}>{cp.name}</Title>
                        {cp.description ? (
                          <Body muted style={{ fontSize: 12, marginTop: 4 }} numberOfLines={2}>
                            {cp.description}
                          </Body>
                        ) : null}
                        {cp.target_amount_paise ? (
                          <Body muted style={{ fontSize: 12, marginTop: 6 }}>
                            {rupees(cp.raised_amount_paise ?? 0)} / {rupees(cp.target_amount_paise)}
                          </Body>
                        ) : null}
                      </Card>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <View style={{ gap: 8 }}>
              <Body muted style={{ fontSize: 12 }}>{hi ? "राशि *" : "Amount *"}</Body>
              <Row style={{ gap: 8, flexWrap: "wrap" }}>
                {PRESETS.map((p) => {
                  const on = amount === p;
                  return (
                    <Pressable
                      key={p}
                      onPress={() => {
                        setAmount(on ? null : p);
                        setCustomAmount("");
                      }}
                      style={{
                        borderWidth: 1,
                        borderColor: on ? c.primary : c.border,
                        backgroundColor: on ? c.accent : c.card,
                        borderRadius: 999,
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                      }}
                    >
                      <Numeric style={{ fontSize: 14 }}>₹{p}</Numeric>
                    </Pressable>
                  );
                })}
              </Row>
              <TextInput
                value={customAmount}
                onChangeText={(v) => {
                  setCustomAmount(v.replace(/[^0-9]/g, ""));
                  setAmount(null);
                }}
                keyboardType="number-pad"
                placeholder={hi ? "अन्य राशि (₹)" : "Other amount (₹)"}
                placeholderTextColor={c.mutedForeground}
                style={inputStyle}
              />
            </View>

            <View style={{ gap: 6 }}>
              <Body muted style={{ fontSize: 12 }}>{hi ? "आपका नाम *" : "Your name *"}</Body>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={hi ? "पूरा नाम" : "Full name"}
                placeholderTextColor={c.mutedForeground}
                style={inputStyle}
              />
            </View>
            <View style={{ gap: 6 }}>
              <Body muted style={{ fontSize: 12 }}>{hi ? "मोबाइल *" : "Mobile *"}</Body>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="98xxxxxxxx"
                placeholderTextColor={c.mutedForeground}
                style={inputStyle}
              />
            </View>

            {error ? <Body style={{ color: c.errorText, fontSize: 13 }}>{error}</Body> : null}

            <Button
              label={hi ? "संकल्प भेजें" : "Send pledge"}
              loading={busy}
              disabled={busy}
              onPress={() => void submit()}
            />
            <Body muted style={{ fontSize: 12 }}>
              {hi
                ? "टीम भुगतान पूरा करने के लिए संपर्क करेगी। ऑनलाइन भुगतान वेबसाइट पर भी उपलब्ध है।"
                : "The team will contact you to complete the payment. Online payment is also available on the website."}
            </Body>
          </View>
        )}
      </Screen>
    </View>
  );
}
