/**
 * Content-request form rules — Section 17 v3 §17.10.3.
 *
 * Deliberately free of React Native imports so it can be unit-tested without
 * pulling the RN runtime into the test environment. Returns i18n KEYS rather
 * than copy: the screen localises them, so the wording lives only in
 * @workspace/i18n and both locales stay in step.
 *
 * This MIRRORS the server contract, it does not replace it — the API validates
 * the same rules again. The point is to tell someone their details are too
 * short before they wait on a round trip.
 */

/** "Other" is a picker sentinel, never a section id. */
export const OTHER_SECTION = "__other__";

export type LibraryRequestFormValues = {
  sectionChoice: string | null;
  suggestedSection: string;
  title: string;
  details: string;
  referenceUrl: string;
  name: string;
  phone: string;
};

/** 10 digits, optionally already carrying the 91 country code or a leading +. */
export function isIndianMobile(raw: string): boolean {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return true;
  return d.length === 12 && d.startsWith("91");
}

export function validateLibraryRequest(v: LibraryRequestFormValues): string | null {
  if (!v.sectionChoice) return "errSectionRequired";
  if (v.sectionChoice === OTHER_SECTION && v.suggestedSection.trim().length === 0) {
    return "errSuggestedRequired";
  }
  if (v.title.trim().length === 0) return "errTitleRequired";
  if (v.details.trim().length < 20) return "errDetailsShort";
  const url = v.referenceUrl.trim();
  if (url.length > 0 && !/^https?:\/\/\S+$/i.test(url)) return "errReferenceUrl";
  if (v.name.trim().length === 0) return "errNameRequired";
  if (!isIndianMobile(v.phone)) return "errPhoneRequired";
  return null;
}
