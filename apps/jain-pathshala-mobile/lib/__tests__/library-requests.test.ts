/**
 * Library content-request form rules + the bilingual copy they resolve to.
 *
 * The validator returns i18n KEYS, so these tests double as a check that every
 * key it can return actually exists in BOTH catalogs — a missing Hindi string
 * would otherwise fall back to English silently and only be noticed by a
 * Hindi-reading parent.
 */
import { describe, it, expect } from "vitest";
import { t } from "@workspace/i18n";
import {
  OTHER_SECTION,
  isIndianMobile,
  validateLibraryRequest,
  type LibraryRequestFormValues,
} from "../library/request-validation";

const VALID: LibraryRequestFormValues = {
  sectionChoice: "5d9c1c2e-0000-4000-8000-000000000000",
  suggestedSection: "",
  title: "Bhaktamar Stotra",
  details: "Please add the full recording with the Hindi meaning after each verse.",
  referenceUrl: "",
  name: "Meera Shah",
  phone: "9876543210",
};

describe("library request validation", () => {
  it("accepts a complete form", () => {
    expect(validateLibraryRequest(VALID)).toBeNull();
  });

  it("requires a targeting path", () => {
    expect(validateLibraryRequest({ ...VALID, sectionChoice: null })).toBe("errSectionRequired");
  });

  it("requires the free-text section when Other is chosen", () => {
    expect(
      validateLibraryRequest({ ...VALID, sectionChoice: OTHER_SECTION, suggestedSection: "  " }),
    ).toBe("errSuggestedRequired");
    expect(
      validateLibraryRequest({
        ...VALID,
        sectionChoice: OTHER_SECTION,
        suggestedSection: "Paryushan pravachans",
      }),
    ).toBeNull();
  });

  it("holds the 20-character content floor, counting trimmed text", () => {
    expect(validateLibraryRequest({ ...VALID, details: "too short" })).toBe("errDetailsShort");
    expect(validateLibraryRequest({ ...VALID, details: `${" ".repeat(40)}short${" ".repeat(40)}` })).toBe(
      "errDetailsShort",
    );
  });

  it("accepts an empty reference link but rejects a non-http one", () => {
    expect(validateLibraryRequest({ ...VALID, referenceUrl: "" })).toBeNull();
    expect(
      validateLibraryRequest({ ...VALID, referenceUrl: "https://youtu.be/abc123" }),
    ).toBeNull();
    // eslint-disable-next-line no-script-url
    expect(validateLibraryRequest({ ...VALID, referenceUrl: "javascript:alert(1)" })).toBe(
      "errReferenceUrl",
    );
    expect(validateLibraryRequest({ ...VALID, referenceUrl: "youtube.com/watch" })).toBe(
      "errReferenceUrl",
    );
  });

  it("requires a name and a reachable mobile number", () => {
    expect(validateLibraryRequest({ ...VALID, name: "   " })).toBe("errNameRequired");
    expect(validateLibraryRequest({ ...VALID, phone: "12345" })).toBe("errPhoneRequired");
  });
});

describe("mobile number shapes", () => {
  it("accepts what people actually type", () => {
    expect(isIndianMobile("9876543210")).toBe(true);
    expect(isIndianMobile("98765 43210")).toBe(true);
    expect(isIndianMobile("+91 98765 43210")).toBe(true);
    expect(isIndianMobile("919876543210")).toBe(true);
  });

  it("rejects the wrong length", () => {
    expect(isIndianMobile("987654321")).toBe(false);
    expect(isIndianMobile("98765432101")).toBe(false);
    expect(isIndianMobile("")).toBe(false);
  });
});

describe("bilingual copy", () => {
  const ERROR_KEYS = [
    "errSectionRequired",
    "errSuggestedRequired",
    "errTitleRequired",
    "errDetailsShort",
    "errReferenceUrl",
    "errNameRequired",
    "errPhoneRequired",
    "errRateLimited",
    "errPendingLimit",
    "errSectionGone",
    "errGeneric",
  ];
  const SCREEN_KEYS = [
    "action",
    "actionHint",
    "searchCta",
    "formTitle",
    "formIntro",
    "sectionLabel",
    "sectionOther",
    "titleLabel",
    "detailsLabel",
    "referenceLabel",
    "nameLabel",
    "phoneLabel",
    "submit",
    "submitting",
    "cancel",
    "offlineTitle",
    "offlineBody",
    "successTitle",
    "successBody",
    "viewMine",
    "myTitle",
    "mySubtitle",
    "empty",
    "emptyHint",
    "loadFailed",
    "tryAgain",
    "statusPending",
    "statusAccepted",
    "statusRejected",
    "statusPublished",
    "adminNoteLabel",
    "openItem",
  ];

  for (const key of [...ERROR_KEYS, ...SCREEN_KEYS]) {
    it(`has real en and hi copy for ${key}`, () => {
      const en = t(`libraryRequests.${key}`, "en");
      const hi = t(`libraryRequests.${key}`, "hi");
      // t() returns the path itself when a key is missing.
      expect(en).not.toBe(`libraryRequests.${key}`);
      expect(hi).not.toBe(`libraryRequests.${key}`);
      // A Hindi string identical to the English one means the translation was
      // forgotten and the catalog fell through to the en fallback.
      expect(hi).not.toBe(en);
      expect(/[ऀ-ॿ]/.test(hi)).toBe(true);
    });
  }

  it("interpolates the request date and suggested section", () => {
    expect(t("libraryRequests.requestedOn", "en", { date: "18 Aug 2026" })).toContain("18 Aug 2026");
    expect(t("libraryRequests.suggestedSectionChip", "hi", { name: "स्तवन" })).toContain("स्तवन");
  });
});
