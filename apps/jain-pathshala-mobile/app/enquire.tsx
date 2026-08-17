/**
 * Enquiry form (guest) — POST /v1/enquiries.
 *
 * The mobile "Enquire" row used to open a static info card whose only action was
 * a mailto: link — on a device with no mail account configured, tapping it did
 * nothing at all, and nothing ever reached the admin Enquiries inbox
 * (GST-API-03). The endpoint was public and fully wired on web the whole time.
 */
import { useState } from "react";
import { TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { apiPost } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error-copy";
import { bodyFamily } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Screen, Title } from "@/components/ui";

export default function EnquireScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();
  // Centre detail links here with the centre name as context.
  const params = useLocalSearchParams<{ subject?: string }>();
  const initialSubject = typeof params.subject === "string" ? params.subject : "";

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [subject] = useState(initialSubject);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

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
    if (!name.trim() || !message.trim()) {
      setError(
        hi
          ? "कृपया अपना नाम और संदेश लिखें।"
          : "Please add your name and a message.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPost("/v1/enquiries", {
        kind: "enquire",
        name: name.trim(),
        phone: phone.trim() || undefined,
        city: city.trim() || undefined,
        subject: subject || undefined,
        message: message.trim(),
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
        <AppHeader title={hi ? "पूछताछ" : "Enquire"} />
        <Screen>
          <Card style={{ marginTop: 20 }}>
            <Title style={{ fontSize: 18 }}>
              {hi ? "संदेश भेज दिया गया" : "Your message has been sent"}
            </Title>
            <Body muted style={{ marginTop: 8 }}>
              {hi
                ? "हमारी टीम जल्द ही आपसे संपर्क करेगी।"
                : "Our team will get back to you soon."}
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
        title={hi ? "पूछताछ" : "Enquire"}
        subtitle={hi ? "प्रवेश या पाठशाला के बारे में पूछें" : "Ask about admission or the pathshala"}
      />
      <Screen scroll>
        <View style={{ gap: 12, marginTop: 8 }}>
          {subject ? (
            <Body muted style={{ fontSize: 13 }}>
              {hi ? "विषय: " : "About: "}
              {subject}
            </Body>
          ) : null}
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
            <Body muted style={{ fontSize: 12 }}>{hi ? "मोबाइल" : "Mobile"}</Body>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="98xxxxxxxx"
              placeholderTextColor={c.mutedForeground}
              style={inputStyle}
            />
          </View>
          <View style={{ gap: 6 }}>
            <Body muted style={{ fontSize: 12 }}>{hi ? "शहर" : "City"}</Body>
            <TextInput
              value={city}
              onChangeText={setCity}
              placeholder={hi ? "आपका शहर" : "Your city"}
              placeholderTextColor={c.mutedForeground}
              style={inputStyle}
            />
          </View>
          <View style={{ gap: 6 }}>
            <Body muted style={{ fontSize: 12 }}>{hi ? "संदेश *" : "Message *"}</Body>
            <TextInput
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={4}
              placeholder={
                hi ? "हम आपकी कैसे मदद कर सकते हैं?" : "How can we help you?"
              }
              placeholderTextColor={c.mutedForeground}
              style={{ ...inputStyle, minHeight: 110, textAlignVertical: "top" }}
            />
          </View>

          {error ? (
            <Body style={{ color: c.errorText, fontSize: 13 }}>{error}</Body>
          ) : null}

          <Button
            label={hi ? "भेजें" : "Send"}
            loading={busy}
            disabled={busy}
            onPress={() => void submit()}
          />
        </View>
      </Screen>
    </View>
  );
}
