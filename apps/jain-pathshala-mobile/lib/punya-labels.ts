/**
 * Bilingual labels for Punya feature keys.
 *
 * The ledger previously rendered `humanize(feature_key)` — a Title-Cased English
 * snake_case key — so a student reading the app in Hindi saw "Attendance Present"
 * and "Niyam Daily" in Latin script under a Devanagari heading. Punya is the
 * student's headline screen; it should read in their language.
 *
 * Unknown keys fall back to the humanised form, so a newly-added feature degrades
 * to today's behaviour rather than rendering blank.
 */
const LABELS: Record<string, { en: string; hi: string }> = {
  attendance_present: { en: "Attendance", hi: "उपस्थिति" },
  attendance_late: { en: "Attendance (late)", hi: "उपस्थिति (विलंब)" },
  attendance_streak: { en: "Attendance streak", hi: "उपस्थिति लकीर" },
  niyam_daily: { en: "Daily niyam", hi: "दैनिक नियम" },
  niyam_weekly: { en: "Weekly niyam", hi: "साप्ताहिक नियम" },
  niyam_monthly: { en: "Monthly niyam", hi: "मासिक नियम" },
  niyam_streak: { en: "Niyam streak", hi: "नियम लकीर" },
  homework_completion: { en: "Homework", hi: "गृहकार्य" },
  course_completion: { en: "Course completed", hi: "पाठ्यक्रम पूर्ण" },
  course_section: { en: "Course section", hi: "पाठ्यक्रम अनुभाग" },
  quiz: { en: "Quiz", hi: "प्रश्नोत्तरी" },
  quiz_win: { en: "Quiz winner", hi: "प्रश्नोत्तरी विजेता" },
  push_quiz: { en: "Live quiz", hi: "लाइव प्रश्नोत्तरी" },
  exam_completion: { en: "Exam", hi: "परीक्षा" },
  exam_top_score: { en: "Top score", hi: "सर्वोच्च अंक" },
  competition: { en: "Competition", hi: "प्रतियोगिता" },
  msv_shivir: { en: "Shivir", hi: "शिविर" },
  manual_award: { en: "Awarded by Guruji", hi: "गुरुजी द्वारा प्रदत्त" },
};

/** Title-case a snake_case key — the pre-existing fallback behaviour. */
function humanize(key: string): string {
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function punyaFeatureLabel(featureKey: string, hi: boolean): string {
  const entry = LABELS[featureKey];
  if (!entry) return humanize(featureKey);
  return hi ? entry.hi : entry.en;
}

/**
 * Bilingual tier names.
 *
 * Every surface rendered `summary.tier` verbatim — the raw lowercase enum,
 * "shravak", in 11px Latin, under a Devanagari heading, on the screen that is
 * the emotional payload of the whole module. A correct bilingual mapping
 * existed but was file-local to the shikshak standings screen, which was itself
 * dead because its route 404'd.
 *
 * Jain terms stay untransliterated in both languages (CLAUDE.md): a tier is a
 * spiritual rank, not a label to translate.
 */
/**
 * L8 — the tier ladder, in ONE place on the client.
 *
 * shikshak/punya.tsx kept its own `TIER_ORDER` copy of the server enum, so
 * adding or reordering a tier meant remembering a file nobody would think to
 * look in. Ordered lowest to highest, matching TIERS in the schema.
 */
export const PUNYA_TIERS = [
  "jigyasu",
  "shravak",
  "sadhak",
  "shraman",
  "tirthankar",
] as const;

const TIER_LABELS: Record<string, { en: string; hi: string }> = {
  jigyasu: { en: "Jigyasu", hi: "जिज्ञासु" },
  shravak: { en: "Shravak", hi: "श्रावक" },
  sadhak: { en: "Sadhak", hi: "साधक" },
  shraman: { en: "Shraman", hi: "श्रमण" },
  tirthankar: { en: "Tirthankar", hi: "तीर्थंकर" },
};

/** Display name for a tier. Unknown values degrade to the humanised key. */
export function punyaTierLabel(tier: string | null | undefined, hi: boolean): string {
  if (!tier) return "—";
  const entry = TIER_LABELS[tier];
  if (!entry) return humanize(tier);
  return hi ? entry.hi : entry.en;
}
