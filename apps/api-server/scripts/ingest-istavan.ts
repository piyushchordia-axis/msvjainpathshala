/**
 * Ingest all MP3s from the Istavan folder into stavan_bhakti → Istavan.
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL = "postgres://jp:jp_dev_pwd@localhost:5434/jainpathshala"
 *   $env:ISTAVAN_DIR = "E:\Enaa Creations\MSV\Istavan"   # optional
 *   $env:FFMPEG_PATH / FFPROBE_PATH as needed
 *   pnpm --filter @workspace/api-server run ingest:istavan
 */
import { readdir, readFile, access } from "node:fs/promises";
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
import { and, desc, eq, isNull } from "drizzle-orm";
import { processLibraryMp3 } from "../src/lib/library-audio";

const DEFAULT_DIR = "E:\\Enaa Creations\\MSV\\Istavan";

function slugifyItemCode(stem: string): string {
  const slug = stem
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error(`Could not slugify filename stem: ${stem}`);
  return slug.slice(0, 80);
}

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

async function ensureSubsection(
  sectionId: string,
  names: { en: string; hi: string; gu: string },
  preferredOrder: number,
) {
  const [existing] = await db
    .select()
    .from(library_subsections)
    .where(
      and(
        eq(library_subsections.section_id, sectionId),
        eq(library_subsections.name_en, names.en),
        isNull(library_subsections.deleted_at),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [maxRow] = await db
    .select({ order_index: library_subsections.order_index })
    .from(library_subsections)
    .where(
      and(
        eq(library_subsections.section_id, sectionId),
        isNull(library_subsections.deleted_at),
      ),
    )
    .orderBy(desc(library_subsections.order_index))
    .limit(1);
  const orderIndex =
    maxRow && maxRow.order_index >= preferredOrder
      ? maxRow.order_index + 1
      : preferredOrder;

  const [subsection] = await db
    .insert(library_subsections)
    .values({
      section_id: sectionId,
      name_en: names.en,
      name_hi: names.hi,
      name_gu: names.gu,
      order_index: orderIndex,
      draft_name_en: names.en,
      draft_name_hi: names.hi,
      draft_name_gu: names.gu,
      draft_order_index: orderIndex,
      is_published: true,
      content_version: 1,
    })
    .returning();
  if (!subsection) throw new Error(`Failed to create subsection ${names.en}`);
  return subsection;
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

  const subsection = await ensureSubsection(
    section.id,
    { en: "Istavan", hi: "इस्तवन", gu: "ઇસ્તવન" },
    1,
  );
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

async function nextOrderIndex(subsectionId: string): Promise<number> {
  const [row] = await db
    .select({ order_index: library_items.order_index })
    .from(library_items)
    .where(
      and(
        eq(library_items.subsection_id, subsectionId),
        isNull(library_items.deleted_at),
      ),
    )
    .orderBy(desc(library_items.order_index))
    .limit(1);
  return (row?.order_index ?? -1) + 1;
}

async function ingestOne(
  mp3Path: string,
  sectionId: string,
  subsectionId: string,
  uploadedBy: string | undefined,
  orderIndex: number,
) {
  const filename = path.basename(mp3Path);
  const stem = filename.replace(/\.mp3$/i, "");
  const itemCode = slugifyItemCode(stem);
  const title = stem.trim();

  const fields = {
    section_id: sectionId,
    subsection_id: subsectionId,
    title_en: title,
    title_hi: title,
    title_gu: title,
    youtube_url: null as string | null,
    text_content_en: null as string | null,
    text_content_hi: null as string | null,
    text_content_gu: null as string | null,
    draft_title_en: title,
    draft_title_hi: title,
    draft_title_gu: title,
    draft_youtube_url: null as string | null,
    draft_text_content_en: null as string | null,
    draft_text_content_hi: null as string | null,
    draft_text_content_gu: null as string | null,
    is_published: true,
    content_version: 1,
    updated_at: new Date(),
  };

  const [existing] = await db
    .select()
    .from(library_items)
    .where(and(eq(library_items.item_code, itemCode), isNull(library_items.deleted_at)))
    .limit(1);

  let itemId: string;
  if (existing) {
    const [row] = await db
      .update(library_items)
      .set(fields)
      .where(eq(library_items.id, existing.id))
      .returning({ id: library_items.id });
    itemId = row!.id;
    console.log(`  update ${itemCode}`);
  } else {
    const [row] = await db
      .insert(library_items)
      .values({
        item_code: itemCode,
        order_index: orderIndex,
        draft_order_index: orderIndex,
        ...fields,
      })
      .returning({ id: library_items.id });
    itemId = row!.id;
    console.log(`  create ${itemCode} order=${orderIndex}`);
  }

  console.log(`  transcoding ${filename}…`);
  const buf = await readFile(mp3Path);
  const audio = await processLibraryMp3(buf, filename);
  console.log(
    `  audio key=${audio.key} size=${audio.size_bytes} duration=${audio.duration_sec}s`,
  );

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

  return { itemCode, itemId, audioUrl: audio.url };
}

async function main() {
  await loadDotEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const dir = process.env.ISTAVAN_DIR?.trim() || DEFAULT_DIR;
  await access(dir);

  const entries = await readdir(dir);
  const mp3s = entries
    .filter((n) => n.toLowerCase().endsWith(".mp3"))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((n) => path.join(dir, n));

  if (mp3s.length === 0) {
    throw new Error(`No MP3 files in ${dir}`);
  }

  const { section, subsection } = await resolveSectionAndSubsection();
  const uploadedBy = await actorUserId();
  let order = await nextOrderIndex(subsection.id);

  console.log(`Ingesting ${mp3s.length} MP3(s) from ${dir}`);
  console.log(`Section ${section.key} → subsection ${subsection.name_en}`);

  const results = [];
  for (const mp3 of mp3s) {
    console.log(`\n→ ${path.basename(mp3)}`);
    const r = await ingestOne(mp3, section.id, subsection.id, uploadedBy, order);
    results.push(r);
    order += 1;
  }

  console.log(`\nDone — ${results.length} items:`);
  for (const r of results) {
    console.log(`  ${r.itemCode}  ${r.itemId}`);
  }
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
