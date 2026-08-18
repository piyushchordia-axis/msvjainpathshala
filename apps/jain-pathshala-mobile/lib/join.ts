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
    keys: ["name", "father_name", "sex", "date_of_birth"],
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
    keys: ["name", "s_o", "sex", "date_of_birth"],
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

/** Whole years from an ISO `YYYY-MM-DD` date of birth. NaN when unparseable. */
export function ageYearsFromDobString(dob: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob.trim());
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const born = new Date(Date.UTC(y, mo - 1, d));
  // Round-trip guards impossible dates like 2014-02-31.
  if (
    born.getUTCFullYear() !== y ||
    born.getUTCMonth() !== mo - 1 ||
    born.getUTCDate() !== d
  ) {
    return NaN;
  }
  const now = new Date();
  let age = now.getUTCFullYear() - y;
  const hadBirthday =
    now.getUTCMonth() + 1 > mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() >= d);
  if (!hadBirthday) age -= 1;
  return age;
}

/**
 * Validate a date of birth for a persona's accepted age band.
 * Returns a bilingual message stating the problem AND the fix, or null.
 */
export function dobProblem(
  dob: string | undefined,
  minAge: number,
  maxAge: number,
  hi: boolean,
): string | null {
  if (!dob) {
    return hi ? "जन्म तिथि चुनें" : "Choose a date of birth";
  }
  const age = ageYearsFromDobString(dob);
  if (!Number.isFinite(age)) {
    return hi
      ? "यह तारीख़ मान्य नहीं है — दिन और महीना जाँचें।"
      : "That date is not valid — check the day and month.";
  }
  if (age < 0) {
    return hi
      ? "जन्म तिथि भविष्य में नहीं हो सकती — वर्ष जाँचें।"
      : "A date of birth cannot be in the future — check the year.";
  }
  if (age < minAge || age > maxAge) {
    return hi
      ? `आयु ${minAge} से ${maxAge} वर्ष के बीच होनी चाहिए — जन्म तिथि जाँचें।`
      : `Age must be between ${minAge} and ${maxAge} — check the date of birth.`;
  }
  return null;
}
