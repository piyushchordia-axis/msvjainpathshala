import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect } from "react";
import { useLocale, type Locale } from "@/contexts/LocaleContext";

export type JoinKind = "student" | "shikshak" | "sanchalak";

export interface JoinField {
  id: string;
  kind?: string;
  field_key: string;
  label_hi: string;
  label_en: string;
  field_type: string;
  options: string[] | null;
  placeholder_hi: string | null;
  placeholder_en: string | null;
  is_required: boolean;
  display_order?: number;
}

export interface JoinSection {
  id: string;
  title_en: string;
  title_hi: string;
  sub_en: string;
  sub_hi: string;
  keys: string[];
  includeCity?: boolean;
  includeCentre?: boolean;
  includeRole?: boolean;
  includePhoto?: boolean;
}

export const STUDENT_SECTIONS: JoinSection[] = [
  {
    id: "about",
    title_en: "About you",
    title_hi: "आपके बारे में",
    sub_en: "Basic identity details",
    sub_hi: "मूल पहचान विवरण",
    keys: ["name", "father_name", "sex", "age"],
    includePhoto: true,
  },
  {
    id: "contact",
    title_en: "Contact",
    title_hi: "संपर्क",
    sub_en: "Parent mobile for login, city and centre",
    sub_hi: "अभिभावक मोबाइल (लॉगिन), शहर और केंद्र",
    keys: ["parent_mobile", "mobile", "email", "address"],
    includeCity: true,
    includeCentre: true,
  },
  {
    id: "notes",
    title_en: "Notes & review",
    title_hi: "नोट और समीक्षा",
    sub_en: "Anything else we should know",
    sub_hi: "कुछ और जो हमें जानना चाहिए",
    keys: ["special_note"],
  },
];

export const STAFF_SECTIONS: JoinSection[] = [
  {
    id: "about",
    title_en: "About you",
    title_hi: "आपके बारे में",
    sub_en: "Basic identity details",
    sub_hi: "मूल पहचान विवरण",
    keys: ["name", "s_o", "age"],
    includeRole: true,
    includePhoto: true,
  },
  {
    id: "contact",
    title_en: "Contact & centre",
    title_hi: "संपर्क और केंद्र",
    sub_en: "WhatsApp and Pathshala centre",
    sub_hi: "WhatsApp और पाठशाला केंद्र",
    keys: ["whatsapp_contact", "address"],
    includeCentre: true,
  },
  {
    id: "pathshala",
    title_en: "Seva details",
    title_hi: "सेवा विवरण",
    sub_en: "Qualification and Pathshala experience",
    sub_hi: "योग्यता और पाठशाला अनुभव",
    keys: [
      "school_qualification",
      "religious_education",
      "years_at_pathshala",
      "current_pathshala",
      "pathshala_name",
      "pathshala_timing",
      "vision",
    ],
  },
];

export function fieldLabel(f: Pick<JoinField, "label_hi" | "label_en">, hi: boolean): string {
  return hi ? f.label_hi || f.label_en : f.label_en || f.label_hi;
}

export function fieldPlaceholder(
  f: Pick<JoinField, "placeholder_hi" | "placeholder_en">,
  hi: boolean,
): string | undefined {
  const p = hi ? f.placeholder_hi || f.placeholder_en : f.placeholder_en || f.placeholder_hi;
  return p ?? undefined;
}

export function optionLabel(value: string, hi: boolean): string {
  const map: Record<string, { en: string; hi: string }> = {
    Male: { en: "Male", hi: "पुरुष" },
    Female: { en: "Female", hi: "महिला" },
    yes: { en: "Yes", hi: "हाँ" },
    no: { en: "No", hi: "नहीं" },
  };
  const m = map[value];
  if (!m) return value;
  return hi ? m.hi : m.en;
}

export function fieldsForSection(fields: JoinField[], section: JoinSection): JoinField[] {
  const byKey = new Map(fields.map((f) => [f.field_key, f]));
  return section.keys.map((k) => byKey.get(k)).filter((f): f is JoinField => !!f);
}

export function photoField(fields: JoinField[]): JoinField | undefined {
  return fields.find((f) => f.field_type === "photo" || f.field_key === "photo");
}

/** Prefer Hindi on first visit to join when no locale is stored yet. */
export function usePreferJoinHindi(): void {
  const { setLocale } = useLocale();
  useEffect(() => {
    void AsyncStorage.getItem("jp_locale").then((stored) => {
      if (stored !== "hi" && stored !== "en") {
        setLocale("hi" as Locale);
      }
    });
  }, [setLocale]);
}
