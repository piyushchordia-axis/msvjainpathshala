/**
 * Shared library sample pack (Section → SubSection → Item).
 * Used by full seed and by library-only reseed (`seed:library`).
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
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
    // FK order: items → subsections → sections
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
        requires_login: true,
        draft_name_en: "Courses",
        draft_name_hi: "पाठ्यक्रम",
        draft_name_gu: "અભ્યાસક્રમ",
        draft_type: "deeplink",
        draft_deeplink_target: "/courses",
        draft_requires_login: true,
        draft_order_index: 3,
        is_published: true,
        content_version: 1,
      },
    ])
    .returning();

  const libStavan = sections.find((s) => s.key === "stavan_bhakti");
  if (!libStavan) {
    throw new Error("seedLibraryContent: stavan_bhakti section missing after insert");
  }

  const [libSub] = await db
    .insert(library_subsections)
    .values({
      section_id: libStavan.id,
      name_en: "Daily stavans",
      name_hi: "दैनिक स्तवन",
      name_gu: "દૈનિક સ્તવન",
      order_index: 0,
      draft_name_en: "Daily stavans",
      draft_name_hi: "दैनिक स्तवन",
      draft_name_gu: "દૈનિક સ્તવન",
      draft_order_index: 0,
      is_published: true,
      content_version: 1,
    })
    .returning();

  if (!libSub) {
    throw new Error("seedLibraryContent: subsection insert returned no row");
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
      draft_title_en: "Stavan Collection Vol. 1",
      draft_title_hi: "स्तवन संग्रह भाग 1",
      draft_title_gu: "સ્તવન સંગ્રહ ભાગ 1",
      draft_order_index: 1,
      draft_audio_url: "https://example.org/audio/stavan-1.mp3",
      draft_audio_size_bytes: 1_024_000,
      draft_audio_duration_sec: 180,
      is_published: true,
      content_version: 1,
    },
  ]);

  return {
    sectionIds: sections.map((s) => s.id),
    subsectionId: libSub.id,
    itemCodes: ["navkar-intro", "stavan-vol-1"],
  };
}
