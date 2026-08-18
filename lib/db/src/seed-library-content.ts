/**
 * Shared library sample pack (Section → SubSection → Item).
 * Used by full seed and by library-only reseed (`seed:library`).
 */
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  cities,
  granth_availability,
  granth_entries,
  granth_libraries,
  library_items,
  library_sections,
  library_subsections,
} from "./schema";
import type * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;

export type SeedLibraryResult = {
  sectionIds: string[];
  subsectionId: string;
  itemCodes: string[];
};

/**
 * Insert the canonical published library sample.
 * Pass `replace: true` to wipe existing library tree rows first (library-only reseed).
 */
export async function seedLibraryContent(
  db: Db,
  opts: { replace?: boolean } = {},
): Promise<SeedLibraryResult> {
  if (opts.replace) {
    // FK order: availability → entries/libraries (they point at items) → items → subsections → sections
    await db.delete(granth_availability);
    await db.delete(granth_entries);
    await db.delete(granth_libraries);
    await db.delete(library_items);
    await db.delete(library_subsections);
    await db.delete(library_sections);
  }

  const sections = await db
    .insert(library_sections)
    .values([
      {
        key: "stavan_bhakti",
        name_en: "Stavan & Bhakti",
        name_hi: "स्तवन एवं भक्ति",
        name_gu: "સ્તવન અને ભક્તિ",
        order_index: 0,
        type: "item_list",
        requires_login: false,
        draft_name_en: "Stavan & Bhakti",
        draft_name_hi: "स्तवन एवं भक्ति",
        draft_name_gu: "સ્તવન અને ભક્તિ",
        draft_type: "item_list",
        draft_requires_login: false,
        draft_order_index: 0,
        is_published: true,
        content_version: 1,
      },
      {
        key: "panchang",
        name_en: "Panchang",
        name_hi: "पंचांग",
        name_gu: "પંચાંગ",
        order_index: 1,
        type: "panchang",
        requires_login: false,
        draft_name_en: "Panchang",
        draft_name_hi: "पंचांग",
        draft_name_gu: "પંચાંગ",
        draft_type: "panchang",
        draft_requires_login: false,
        draft_order_index: 1,
        is_published: true,
        content_version: 1,
      },
      {
        key: "pathshala_join",
        name_en: "Join Pathshala",
        name_hi: "पाठशाला से जुड़ें",
        name_gu: "પાઠશાળા સાથે જોડાઓ",
        order_index: 2,
        type: "deeplink",
        deeplink_target: "/join",
        requires_login: false,
        draft_name_en: "Join Pathshala",
        draft_name_hi: "पाठशाला से जुड़ें",
        draft_name_gu: "પાઠશાળા સાથે જોડાઓ",
        draft_type: "deeplink",
        draft_deeplink_target: "/join",
        draft_requires_login: false,
        draft_order_index: 2,
        is_published: true,
        content_version: 1,
      },
      {
        key: "courses",
        name_en: "Courses",
        name_hi: "पाठ्यक्रम",
        name_gu: "અભ્યાસક્રમ",
        order_index: 3,
        type: "deeplink",
        deeplink_target: "/courses",
        requires_login: false,
        draft_name_en: "Courses",
        draft_name_hi: "पाठ्यक्रम",
        draft_name_gu: "અભ્યાસક્રમ",
        draft_type: "deeplink",
        draft_deeplink_target: "/courses",
        draft_requires_login: false,
        draft_order_index: 3,
        is_published: true,
        content_version: 1,
      },
      {
        /**
         * v3 §17.11.1 — exactly one granth section. Clients key on `type`,
         * never on this name. SPEC seeds it unpublished so an admin can
         * rename before it appears; the local sample pack publishes it with
         * a reference catalogue so the two-tab screen is exercisable the
         * same way Stavan is.
         *
         * SPEC says access_tier='public'. This build has no access_tier
         * column — visibility is the requires_login boolean — so public
         * means requires_login: false.
         */
        key: "granth",
        name_en: "Granth",
        name_hi: "ग्रंथ",
        name_gu: "ગ્રંથ",
        order_index: 4,
        type: "granth",
        requires_login: false,
        draft_name_en: "Granth",
        draft_name_hi: "ग्रंथ",
        draft_name_gu: "ગ્રંથ",
        draft_type: "granth",
        draft_requires_login: false,
        draft_order_index: 4,
        is_published: true,
        content_version: 1,
      },
    ])
    .returning();

  const libStavan = sections.find((s) => s.key === "stavan_bhakti");
  if (!libStavan) {
    throw new Error("seedLibraryContent: stavan_bhakti section missing after insert");
  }

  const stavanSubs = await db
    .insert(library_subsections)
    .values([
      {
        section_id: libStavan.id,
        name_en: "Bhaktamar Stotra",
        name_hi: "भक्तामर स्तोत्र",
        name_gu: "ભક્તામર સ્તોત્ર",
        order_index: 0,
        draft_name_en: "Bhaktamar Stotra",
        draft_name_hi: "भक्तामर स्तोत्र",
        draft_name_gu: "ભક્તામર સ્તોત્ર",
        draft_order_index: 0,
        is_published: true,
        content_version: 1,
      },
      {
        section_id: libStavan.id,
        name_en: "Istavan",
        name_hi: "इस्तवन",
        name_gu: "ઇસ્તવન",
        order_index: 1,
        draft_name_en: "Istavan",
        draft_name_hi: "इस्तवन",
        draft_name_gu: "ઇસ્તવન",
        draft_order_index: 1,
        is_published: true,
        content_version: 1,
      },
      {
        section_id: libStavan.id,
        name_en: "Daily stavans",
        name_hi: "दैनिक स्तवन",
        name_gu: "દૈનિક સ્તવન",
        order_index: 2,
        draft_name_en: "Daily stavans",
        draft_name_hi: "दैनिक स्तवन",
        draft_name_gu: "દૈનિક સ્તવન",
        draft_order_index: 2,
        is_published: true,
        content_version: 1,
      },
    ])
    .returning();

  const libSub = stavanSubs.find((s) => s.name_en === "Daily stavans");
  if (!libSub) {
    throw new Error("seedLibraryContent: Daily stavans subsection missing after insert");
  }

  await db.insert(library_items).values([
    {
      section_id: libStavan.id,
      subsection_id: libSub.id,
      item_code: "navkar-intro",
      title_en: "Introduction to Navkar Mantra",
      title_hi: "नवकार मंत्र का परिचय",
      title_gu: "નવકાર મંત્રનો પરિચય",
      order_index: 0,
      youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      draft_title_en: "Introduction to Navkar Mantra",
      draft_title_hi: "नवकार मंत्र का परिचय",
      draft_title_gu: "નવકાર મંત્રનો પરિચય",
      draft_order_index: 0,
      draft_youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      is_published: true,
      content_version: 1,
    },
    {
      section_id: libStavan.id,
      subsection_id: libSub.id,
      item_code: "stavan-vol-1",
      title_en: "Stavan Collection Vol. 1",
      title_hi: "स्तवन संग्रह भाग 1",
      title_gu: "સ્તવન સંગ્રહ ભાગ 1",
      order_index: 1,
      audio_url: "https://example.org/audio/stavan-1.mp3",
      audio_size_bytes: 1_024_000,
      audio_duration_sec: 180,
      // §17.1.3 — one seeded Tarj so the caption line and its search path
      // are exercisable locally without hand-editing a row.
      tarj_en: "Meri Bhavna",
      tarj_hi: "मेरी भावना",
      draft_title_en: "Stavan Collection Vol. 1",
      draft_title_hi: "स्तवन संग्रह भाग 1",
      draft_title_gu: "સ્તવન સંગ્રહ ભાગ 1",
      draft_order_index: 1,
      draft_audio_url: "https://example.org/audio/stavan-1.mp3",
      draft_audio_size_bytes: 1_024_000,
      draft_audio_duration_sec: 180,
      draft_tarj_en: "Meri Bhavna",
      draft_tarj_hi: "मेरी भावना",
      is_published: true,
      content_version: 1,
    },
  ]);

  const itemCodes = ["navkar-intro", "stavan-vol-1"];
  await seedReferenceGranth(db, sections.find((s) => s.key === "granth")?.id);
  itemCodes.push("tattvartha-sutra", "kalpasutra");

  return {
    sectionIds: sections.map((s) => s.id),
    subsectionId: libSub.id,
    itemCodes,
  };
}

const TATTVARTHA_EN =
  "<p>Umasvati's Tattvartha Sutra is the reference treatise of Jain philosophy — the seven tattvas, the path of samyak darshan, jnana and charitra. This sample is a short public-domain introduction so the Online Granth tab has something to open.</p>";
const TATTVARTHA_HI =
  "<p>उमास्वाति का तत्त्वार्थ सूत्र जैन दर्शन का संदर्भ ग्रंथ है — सात तत्त्व, सम्यक् दर्शन, ज्ञान और चारित्र का मार्ग। यह नमूना एक संक्षिप्त परिचय है ताकि ऑनलाइन ग्रंथ टैब खुल सके।</p>";
const KALPA_EN =
  "<p>The Kalpasutra records the lives of the Tirthankars, with Bhagwan Mahavir's life at its centre, and is recited during Paryushan. This sample is a short public-domain introduction for the Online Granth tab.</p>";
const KALPA_HI =
  "<p>कल्पसूत्र Tirthankar के जीवन का वर्णन है, जिसके केंद्र में भगवान महावीर हैं, और पर्युषण में इसका पाठ होता है। यह नमूना ऑनलाइन ग्रंथ टैब के लिए एक संक्षिप्त परिचय है।</p>";

async function seedReferenceGranth(db: Db, sectionId: string | undefined): Promise<void> {
  if (!sectionId) {
    throw new Error("seedLibraryContent: granth section missing after insert");
  }

  const [agamas] = await db
    .insert(library_subsections)
    .values({
      section_id: sectionId,
      name_en: "Agama & Shastra",
      name_hi: "आगम एवं शास्त्र",
      name_gu: "આગમ અને શાસ્ત્ર",
      order_index: 0,
      draft_name_en: "Agama & Shastra",
      draft_name_hi: "आगम एवं शास्त्र",
      draft_name_gu: "આગમ અને શાસ્ત્ર",
      draft_order_index: 0,
      is_published: true,
      content_version: 1,
    })
    .returning();
  if (!agamas) {
    throw new Error("seedLibraryContent: Agama & Shastra subsection missing after insert");
  }

  const [tattvartha, kalpasutra] = await db
    .insert(library_items)
    .values([
      {
        section_id: sectionId,
        subsection_id: agamas.id,
        item_code: "tattvartha-sutra",
        title_en: "Tattvartha Sutra",
        title_hi: "तत्त्वार्थ सूत्र",
        title_gu: "તત્ત્વાર્થ સૂત્ર",
        order_index: 0,
        text_content_en: TATTVARTHA_EN,
        text_content_hi: TATTVARTHA_HI,
        draft_title_en: "Tattvartha Sutra",
        draft_title_hi: "तत्त्वार्थ सूत्र",
        draft_title_gu: "તત્ત્વાર્થ સૂત્ર",
        draft_order_index: 0,
        draft_text_content_en: TATTVARTHA_EN,
        draft_text_content_hi: TATTVARTHA_HI,
        is_published: true,
        content_version: 1,
      },
      {
        section_id: sectionId,
        subsection_id: agamas.id,
        item_code: "kalpasutra",
        title_en: "Kalpasutra",
        title_hi: "कल्पसूत्र",
        title_gu: "કલ્પસૂત્ર",
        order_index: 1,
        text_content_en: KALPA_EN,
        text_content_hi: KALPA_HI,
        draft_title_en: "Kalpasutra",
        draft_title_hi: "कल्पसूत्र",
        draft_title_gu: "કલ્પસૂત્ર",
        draft_order_index: 1,
        draft_text_content_en: KALPA_EN,
        draft_text_content_hi: KALPA_HI,
        is_published: true,
        content_version: 1,
      },
    ])
    .returning();
  if (!tattvartha || !kalpasutra) {
    throw new Error("seedLibraryContent: reference granth items missing after insert");
  }

  // Directory needs a city. Full seed always has one; library-only reseed
  // on an empty geography would otherwise fail the city_id FK.
  const [preferred] = await db
    .select({ id: cities.id })
    .from(cities)
    .where(eq(cities.slug, "mumbai"))
    .limit(1);
  const [fallback] = preferred
    ? [preferred]
    : await db.select({ id: cities.id }).from(cities).limit(1);
  const cityId = fallback?.id;
  if (!cityId) return;

  const [bhandar] = await db
    .insert(granth_libraries)
    .values({
      name_en: "MSV Granth Bhandar",
      name_hi: "एमएसवी ग्रंथ भंडार",
      address_en: "Ghatkopar Upashray, Mumbai",
      address_hi: "घाटकोपर उपाश्रय, मुंबई",
      city_id: cityId,
      contact_name: "Sanchalak",
      contact_phone: "+912225001234",
      has_whatsapp: true,
      timings_en: "Daily 8:00–12:00 and 16:00–19:00",
      timings_hi: "प्रतिदिन 8:00–12:00 और 16:00–19:00",
      lat: "19.0861000",
      lng: "72.9081000",
      note_en: "Reference copies may be read on site.",
      note_hi: "संदर्भ प्रतियाँ स्थल पर पढ़ी जा सकती हैं।",
      order: 0,
      draft_name_en: "MSV Granth Bhandar",
      draft_name_hi: "एमएसवी ग्रंथ भंडार",
      draft_address_en: "Ghatkopar Upashray, Mumbai",
      draft_address_hi: "घाटकोपर उपाश्रय, मुंबई",
      draft_city_id: cityId,
      draft_contact_name: "Sanchalak",
      draft_contact_phone: "+912225001234",
      draft_has_whatsapp: true,
      draft_timings_en: "Daily 8:00–12:00 and 16:00–19:00",
      draft_timings_hi: "प्रतिदिन 8:00–12:00 और 16:00–19:00",
      draft_lat: "19.0861000",
      draft_lng: "72.9081000",
      draft_note_en: "Reference copies may be read on site.",
      draft_note_hi: "संदर्भ प्रतियाँ स्थल पर पढ़ी जा सकती हैं।",
      draft_order: 0,
      is_published: true,
      content_version: 1,
    })
    .returning();
  if (!bhandar) {
    throw new Error("seedLibraryContent: granth library missing after insert");
  }

  const [tattvarthaEntry, kalpasutraEntry] = await db
    .insert(granth_entries)
    .values([
      {
        title_en: "Tattvartha Sutra",
        title_hi: "तत्त्वार्थ सूत्र",
        author_en: "Umasvati",
        author_hi: "उमास्वाति",
        language: "Sanskrit",
        description_en: "Foundational Jain treatise on the seven tattvas.",
        description_hi: "सात तत्त्वों पर जैन दर्शन का मूल ग्रंथ।",
        linked_item_id: tattvartha.id,
        order: 0,
        draft_title_en: "Tattvartha Sutra",
        draft_title_hi: "तत्त्वार्थ सूत्र",
        draft_author_en: "Umasvati",
        draft_author_hi: "उमास्वाति",
        draft_language: "Sanskrit",
        draft_description_en: "Foundational Jain treatise on the seven tattvas.",
        draft_description_hi: "सात तत्त्वों पर जैन दर्शन का मूल ग्रंथ।",
        draft_linked_item_id: tattvartha.id,
        draft_order: 0,
        is_published: true,
        content_version: 1,
      },
      {
        title_en: "Kalpasutra",
        title_hi: "कल्पसूत्र",
        author_en: "Bhadrabahu",
        author_hi: "भद्रबाहु",
        language: "Prakrit",
        description_en: "Lives of the Tirthankars, recited during Paryushan.",
        description_hi: "Tirthankar के जीवन, पर्युषण में पाठ।",
        linked_item_id: kalpasutra.id,
        order: 1,
        draft_title_en: "Kalpasutra",
        draft_title_hi: "कल्पसूत्र",
        draft_author_en: "Bhadrabahu",
        draft_author_hi: "भद्रबाहु",
        draft_language: "Prakrit",
        draft_description_en: "Lives of the Tirthankars, recited during Paryushan.",
        draft_description_hi: "Tirthankar के जीवन, पर्युषण में पाठ।",
        draft_linked_item_id: kalpasutra.id,
        draft_order: 1,
        is_published: true,
        content_version: 1,
      },
    ])
    .returning();
  if (!tattvarthaEntry || !kalpasutraEntry) {
    throw new Error("seedLibraryContent: granth entries missing after insert");
  }

  await db.insert(granth_availability).values([
    {
      granth_id: tattvarthaEntry.id,
      library_id: bhandar.id,
      note: "reference only, not for issue",
    },
    {
      granth_id: kalpasutraEntry.id,
      library_id: bhandar.id,
      note: "reference only, not for issue",
    },
  ]);
}
