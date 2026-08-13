/**
 * One-shot generator for bundled sample Panchang year JSON (2026).
 * Run: node scripts/generate-panchang-2026.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MONTHS = [
  { key: "kartik", name_en: "Kartik", name_hi: "कार्तिक", name_gu: "કાર્તિક" },
  { key: "margshirsh", name_en: "Margshirsh", name_hi: "मार्गशीर्ष", name_gu: "માર્ગશીર્ષ" },
  { key: "paush", name_en: "Paush", name_hi: "पौष", name_gu: "પૌષ" },
  { key: "magh", name_en: "Magh", name_hi: "माघ", name_gu: "માઘ" },
  { key: "phalgun", name_en: "Phalgun", name_hi: "फाल्गुन", name_gu: "ફાલ્ગુન" },
  { key: "chaitra", name_en: "Chaitra", name_hi: "चैत्र", name_gu: "ચૈત્ર" },
  { key: "vaishakh", name_en: "Vaishakh", name_hi: "वैशाख", name_gu: "વૈશાખ" },
  { key: "jyeshtha", name_en: "Jyeshtha", name_hi: "ज्येष्ठ", name_gu: "જ્યેષ્ઠ" },
  { key: "ashadh", name_en: "Ashadh", name_hi: "आषाढ़", name_gu: "આષાઢ" },
  { key: "shravan", name_en: "Shravan", name_hi: "श्रावण", name_gu: "શ્રાવણ" },
  { key: "bhadrapad", name_en: "Bhadrapad", name_hi: "भाद्रपद", name_gu: "ભાદ્રપદ" },
  { key: "ashwin", name_en: "Ashwin", name_hi: "आश्विन", name_gu: "આસો" },
];

const NAKSHATRAS = [
  "Ashwini",
  "Bharani",
  "Krittika",
  "Rohini",
  "Mrigashira",
  "Ardra",
  "Punarvasu",
  "Pushya",
  "Ashlesha",
  "Magha",
  "Purva Phalguni",
  "Uttara Phalguni",
  "Hasta",
  "Chitra",
  "Swati",
  "Vishakha",
  "Anuradha",
  "Jyeshtha",
  "Mula",
  "Purva Ashadha",
  "Uttara Ashadha",
  "Shravana",
  "Dhanishta",
  "Shatabhisha",
  "Purva Bhadrapada",
  "Uttara Bhadrapada",
  "Revati",
];

const VAAR_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function iso(d) {
  return d.toISOString().slice(0, 10);
}

function uuid(n) {
  const hex = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

/** Illustrative anchors — not astronomical truth. */
const EVENTS_BY_DATE = {
  "2026-01-14": [
    {
      type: "festival",
      title_en: "Makar Sankranti",
      title_hi: "मकर संक्रांति",
      highlight: true,
    },
  ],
  "2026-03-03": [
    {
      type: "festival",
      title_en: "Mahavir Jayanti",
      title_hi: "महावीर जयंती",
      highlight: true,
      linked: true,
    },
  ],
  "2026-04-14": [
    {
      type: "observance",
      title_en: "Akshaya Tritiya",
      title_hi: "अक्षय तृतीया",
      highlight: true,
    },
  ],
  "2026-08-12": [
    {
      type: "observance",
      title_en: "Paryushan starts",
      title_hi: "पर्युषण आरंभ",
      highlight: true,
      linked: true,
    },
    {
      type: "note",
      title_en: "Samvatsari week begins",
      title_hi: "संवत्सरी सप्ताह आरंभ",
      highlight: false,
    },
  ],
  "2026-08-19": [
    {
      type: "festival",
      title_en: "Samvatsari",
      title_hi: "संवत्सरी",
      highlight: true,
      linked: true,
    },
  ],
  "2026-09-14": [
    {
      type: "festival",
      title_en: "Das Lakshan ends",
      title_hi: "दशलक्षण समाप्ति",
      highlight: false,
    },
  ],
  "2026-10-20": [
    {
      type: "festival",
      title_en: "Diwali (Mahavir Nirvana)",
      title_hi: "दीपावली (महावीर निर्वाण)",
      highlight: true,
    },
  ],
  "2026-10-21": [
    {
      type: "festival",
      title_en: "Jain New Year",
      title_hi: "जैन नव वर्ष",
      highlight: true,
    },
  ],
  "2026-11-08": [
    {
      type: "observance",
      title_en: "Kartik Purnima",
      title_hi: "कार्तिक पूर्णिमा",
      highlight: true,
    },
  ],
};

const vridhiDates = new Set([
  "2026-02-10",
  "2026-05-22",
  "2026-08-15",
  "2026-11-03",
]);

let tithi = 10;
let paksha = "sud";
let monthIdx = 2; // Paush around January — 13 Aug 2026 lands in Shravan
let nakIdx = 0;
const days = [];

const start = new Date(Date.UTC(2026, 0, 1));
const end = new Date(Date.UTC(2026, 11, 31));

for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
  const date = iso(d);
  const isVridhi = vridhiDates.has(date);

  if (!isVridhi && days.length > 0) {
    // kshay: jump +2 so a tithi number is absent from the sequence
    const skip =
      date === "2026-03-18" || date === "2026-07-09" || date === "2026-09-27";
    const step = skip ? 2 : 1;
    for (let s = 0; s < step; s++) {
      tithi += 1;
      if (tithi > 15) {
        tithi = 1;
        if (paksha === "sud") {
          paksha = "vad";
        } else {
          paksha = "sud";
          monthIdx = (monthIdx + 1) % MONTHS.length;
        }
      }
    }
  }

  const month = MONTHS[monthIdx];
  const tithiKey = `${paksha}-${tithi}`;
  const parvTithi =
    tithi === 8 || tithi === 14 || tithi === 15 || !!EVENTS_BY_DATE[date];
  const nakshatra = NAKSHATRAS[nakIdx % NAKSHATRAS.length];
  nakIdx += 1;

  const rawEvents = EVENTS_BY_DATE[date] || [];
  const events = rawEvents.map((e, i) => ({
    id: `evt-${date}-${i + 1}`,
    type: e.type,
    title_en: e.title_en,
    title_hi: e.title_hi,
    title_gu: null,
    note_en: e.highlight
      ? "Observance day — check local Pathshala schedule."
      : null,
    note_hi: e.highlight
      ? "व्रत / पर्व दिन — स्थानीय पाठशाला अनुसूची देखें।"
      : null,
    note_gu: null,
    highlight: !!e.highlight,
    linkedItemId: e.linked
      ? uuid(20260000 + Number(date.replace(/-/g, "")) + i)
      : null,
  }));

  days.push({
    date,
    vaar: VAAR_EN[d.getUTCDay()],
    month: month.key,
    isAdhikMaas: false,
    paksha,
    tithi,
    tithiKey,
    tithiStatus: isVridhi ? "vridhi" : "normal",
    nakshatra,
    parvTithi,
    events,
  });
}

const payload = {
  schemaVersion: 1,
  contentVersion: 2,
  sect: "shwetambar",
  vikramSamvat: 2082,
  veerSamvat: 2552,
  year: 2026,
  months: MONTHS.map((m) => ({ ...m, isAdhik: false })),
  days,
};

const outDir = path.join(__dirname, "..", "assets", "data");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "panchang-2026.json");
fs.writeFileSync(outPath, JSON.stringify(payload));
console.log(
  "wrote",
  outPath,
  "days=",
  days.length,
  "kb=",
  Math.round(fs.statSync(outPath).size / 1024),
);
