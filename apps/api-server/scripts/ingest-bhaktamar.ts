/**
 * Ingest Bhaktamar Stotra into the library (published item + MP3 + YouTube).
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL = "postgres://jp:jp_dev_pwd@localhost:5434/jainpathshala"
 *   $env:BHAKTAMAR_MP3_PATH = "C:\Users\Admin\Downloads\bhaktamar-stotra.mp3"  # optional
 *   pnpm --filter @workspace/api-server run ingest:bhaktamar
 *
 * Requires ffmpeg on PATH (or FFMPEG_PATH / FFPROBE_PATH).
 */
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  db,
  pool,
  library_items,
  library_sections,
  library_subsections,
  upload_objects,
  users,
} from "@workspace/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { processLibraryMp3 } from "../src/lib/library-audio";
import { sanitizeLibraryHtml } from "../src/lib/library-sanitize-html";
import {
  bhaktamarStotraHiHtml,
} from "../../../lib/db/src/content/bhaktamar-stotra-hi";

const ITEM_CODE = "bhaktamar-stotra";
const YOUTUBE = "https://www.youtube.com/watch?v=RZY6kVsNwSQ";
const TITLE_EN = "Bhaktamar Stotra";
const TITLE_HI = "भक्तामर स्तोत्र";
const TEXT_EN =
  "Bhaktamar Stotra — 48 verses in praise of Lord Adinath (Hindi text).";

const DEFAULT_MP3 = "C:\\Users\\Admin\\Downloads\\bhaktamar-stotra.mp3";

async function loadDotEnv() {
  const envPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.env",
  );
  try {
    const text = await readFile(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim();
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

async function resolveSectionAndSubsection() {
  const [section] = await db
    .select()
    .from(library_sections)
    .where(
      and(eq(library_sections.key, "stavan_bhakti"), isNull(library_sections.deleted_at)),
    )
    .limit(1);
  if (!section) {
    throw new Error(
      'Section key "stavan_bhakti" not found — run seed:library first.',
    );
  }

  const [existingSub] = await db
    .select()
    .from(library_subsections)
    .where(
      and(
        eq(library_subsections.section_id, section.id),
        isNull(library_subsections.deleted_at),
      ),
    )
    .orderBy(asc(library_subsections.order_index))
    .limit(1);

  if (existingSub) return { section, subsection: existingSub };

  const [subsection] = await db
    .insert(library_subsections)
    .values({
      section_id: section.id,
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
  if (!subsection) throw new Error("Failed to create Daily stavans subsection");
  return { section, subsection };
}

async function actorUserId(): Promise<string | undefined> {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "super_admin"))
    .limit(1);
  return u?.id;
}

async function main() {
  await loadDotEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const mp3Path = process.env.BHAKTAMAR_MP3_PATH?.trim() || DEFAULT_MP3;
  await access(mp3Path);

  const hiHtml = sanitizeLibraryHtml(bhaktamarStotraHiHtml());
  const { section, subsection } = await resolveSectionAndSubsection();

  const [existing] = await db
    .select()
    .from(library_items)
    .where(and(eq(library_items.item_code, ITEM_CODE), isNull(library_items.deleted_at)))
    .limit(1);

  const fields = {
    section_id: section.id,
    subsection_id: subsection.id,
    title_en: TITLE_EN,
    title_hi: TITLE_HI,
    title_gu: null as string | null,
    youtube_url: YOUTUBE,
    text_content_en: TEXT_EN,
    text_content_hi: hiHtml,
    text_content_gu: null as string | null,
    draft_title_en: TITLE_EN,
    draft_title_hi: TITLE_HI,
    draft_title_gu: null as string | null,
    draft_youtube_url: YOUTUBE,
    draft_text_content_en: TEXT_EN,
    draft_text_content_hi: hiHtml,
    draft_text_content_gu: null as string | null,
    is_published: true,
    content_version: 1,
    updated_at: new Date(),
  };

  let itemId: string;
  if (existing) {
    const [row] = await db
      .update(library_items)
      .set(fields)
      .where(eq(library_items.id, existing.id))
      .returning({ id: library_items.id });
    itemId = row!.id;
    console.log(`Updated existing item ${ITEM_CODE} (${itemId})`);
  } else {
    const orderIndex = 2; // after seed navkar + stavan-vol-1
    const [row] = await db
      .insert(library_items)
      .values({
        item_code: ITEM_CODE,
        order_index: orderIndex,
        draft_order_index: orderIndex,
        ...fields,
      })
      .returning({ id: library_items.id });
    itemId = row!.id;
    console.log(`Created item ${ITEM_CODE} (${itemId})`);
  }

  console.log(`Processing MP3: ${mp3Path}`);
  const buf = await readFile(mp3Path);
  const audio = await processLibraryMp3(buf, "bhaktamar-stotra.mp3");
  console.log(
    `Stored audio key=${audio.key} size=${audio.size_bytes} duration=${audio.duration_sec}s`,
  );

  const uploadedBy = await actorUserId();
  if (uploadedBy) {
    await db
      .insert(upload_objects)
      .values({
        key: audio.key,
        uploaded_by: uploadedBy,
        content_type: "audio/mpeg",
      })
      .onConflictDoNothing();
  }

  await db
    .update(library_items)
    .set({
      audio_url: audio.url,
      audio_size_bytes: audio.size_bytes,
      audio_duration_sec: audio.duration_sec,
      draft_audio_url: audio.url,
      draft_audio_size_bytes: audio.size_bytes,
      draft_audio_duration_sec: audio.duration_sec,
      updated_at: new Date(),
    })
    .where(eq(library_items.id, itemId));

  console.log(`Bhaktamar Stotra ready — item ${itemId}`);
  console.log(`  youtube: ${YOUTUBE}`);
  console.log(`  audio: ${audio.url}`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
