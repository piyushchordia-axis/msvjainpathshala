/**
 * One-off seed: create active course "Jain Sutras" from the markdown outline.
 * Usage: node scripts/seed-jain-sutras-course.mjs [path-to.md]
 */
import fs from "node:fs";
import path from "node:path";
import pg from "../node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js";

const MD_PATH =
  process.argv[2] ||
  path.join("C:", "Users", "Admin", "Downloads", "Jain_Sutra_Collection_Subsections.md");
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://jp:jp_dev_pwd@localhost:5434/jainpathshala";
const CITY_ID = "5742f390-e847-4d10-857b-12112ac8e11f"; // Indore (same as current learner course)
const ACADEMIC_YEAR = "2026-27";

function splitParenTitle(raw) {
  const t = raw.replace(/\s+/g, " ").trim();
  const m = t.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    return { hi: m[1].trim(), en: m[2].trim() };
  }
  // "Sugur Vandana — likely = …" style: keep as both
  return { hi: t, en: t };
}

function extractBlocks(body) {
  const subs = [];
  const re =
    /\*\*Sub-section\s+\d+\.\d+\s*[—–-]\s*(.+?)\*\*\s*([\s\S]*?)(?=\*\*Sub-section\s+\d+\.\d+|\n---|\n##\s|\n## Suggested|$)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const titles = splitParenTitle(m[1]);
    const chunk = m[2].trim();
    const codeBlocks = [...chunk.matchAll(/```\s*([\s\S]*?)```/g)].map((x) => x[1].trim());
    const roman = chunk.match(/\*Roman:\*\s*(.+)/)?.[1]?.trim() ?? "";
    const meaning = chunk.match(/\*Meaning:\*\s*(.+)/)?.[1]?.trim() ?? "";
    const notes = [...chunk.matchAll(/⚠️\s*\*?([\s\S]*?)(?=\n\n|\n\*\*|$)/g)]
      .map((x) => x[1].replace(/\*+/g, "").trim())
      .filter(Boolean);
    const italicNotes = [...chunk.matchAll(/^\*\(([^)]+)\)\*$/gm)].map((x) => x[1].trim());

    const sutra = codeBlocks.join("\n\n");
    const descPartsHi = [];
    const descPartsEn = [];
    if (sutra) {
      descPartsHi.push(sutra);
      descPartsEn.push(sutra);
    }
    if (roman) descPartsEn.push(`Roman: ${roman}`);
    if (meaning) {
      descPartsEn.push(`Meaning: ${meaning}`);
      descPartsHi.push(`अर्थ: ${meaning}`);
    }
    for (const n of [...italicNotes, ...notes]) {
      descPartsHi.push(`नोट: ${n}`);
      descPartsEn.push(`Note: ${n}`);
    }
    // Parenthetical-only subsections (e.g. 14.3)
    if (!sutra && !meaning && italicNotes.length === 0 && notes.length === 0) {
      const plain = chunk
        .replace(/\*+/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (plain) {
        descPartsHi.push(plain);
        descPartsEn.push(plain);
      }
    }

    subs.push({
      title_hi: titles.hi,
      title_en: titles.en,
      description_hi: descPartsHi.join("\n\n") || null,
      description_en: descPartsEn.join("\n\n") || null,
    });
  }
  return subs;
}

function parseMarkdown(md) {
  const sections = [];
  const parts = md.split(/\n(?=##\s+\d+\.\s)/);
  for (const part of parts) {
    const hm = part.match(/^##\s+(\d+)\.\s+(.+?)(?:\n|$)/);
    if (!hm) continue;
    const order = Number(hm[1]) - 1;
    let titleRaw = hm[2].trim();
    // Drop trailing em-dash notes from section title line
    titleRaw = titleRaw.replace(/\s*[—–]\s*.*$/, "").trim();
    const titles = splitParenTitle(titleRaw);
    const body = part.slice(hm[0].length);

    let subs = extractBlocks(body);

    // Section 16: Adhyaya table → subsections
    if (Number(hm[1]) === 16) {
      const tableRows = [...body.matchAll(/\|\s*(\d+)\s*\|\s*([^|]+)\|/g)];
      if (tableRows.length) {
        subs = tableRows.map((r, i) => {
          const topic = r[2].trim();
          const t = splitParenTitle(topic);
          const opening =
            i === 0
              ? [
                  "सम्यग्दर्शन-ज्ञान-चारित्राणि मोक्षमार्गः।",
                  "",
                  "Roman: Samyag-darshana-jnana-charitrani mokshamargah",
                  "Meaning: Right faith, right knowledge, and right conduct together constitute the path to liberation.",
                ].join("\n")
              : `अध्याय ${r[1]} — ${topic}\n\n(Full chapter text to be added from the Tattvartha Sutra reference edition.)`;
          return {
            title_hi: t.hi.includes("ज्ञान") || /[\u0900-\u097F]/.test(t.hi) ? t.hi : topic,
            title_en: /[\u0900-\u097F]/.test(t.en) ? `Adhyaya ${r[1]}` : t.en || `Adhyaya ${r[1]}`,
            description_hi: opening,
            description_en: opening,
          };
        });
        // Prefer bilingual titles from table cells like "ज्ञान एवं प्रमाण (Right knowledge...)"
        subs = tableRows.map((r, i) => {
          const topic = r[2].trim();
          const t = splitParenTitle(topic);
          const base = subs[i];
          return {
            title_hi: t.hi,
            title_en: t.en.startsWith("Adhyaya") ? t.en : t.en,
            description_hi: base.description_hi,
            description_en: base.description_en,
          };
        });
      }
    }

    if (subs.length === 0) {
      // Single continuous sutra — one subsection with full body content
      const codeBlocks = [...body.matchAll(/```\s*([\s\S]*?)```/g)].map((x) => x[1].trim());
      const roman = body.match(/\*Roman:\*\s*(.+)/)?.[1]?.trim() ?? "";
      const meaning = body.match(/\*Meaning:\*\s*(.+)/)?.[1]?.trim() ?? "";
      const warn = body.match(/⚠️\s*\*?\*?([\s\S]*?)(?=\n---|\n##|$)/)?.[1]?.replace(/\*+/g, "").trim();
      const intro = body
        .split("```")[0]
        .replace(/\*\*/g, "")
        .replace(/\n+/g, " ")
        .trim();
      const sutra = codeBlocks.join("\n\n");
      const hi = [];
      const en = [];
      if (intro) {
        hi.push(intro);
        en.push(intro);
      }
      if (sutra) {
        hi.push(sutra);
        en.push(sutra);
      }
      if (roman) en.push(`Roman: ${roman}`);
      if (meaning) {
        en.push(`Meaning: ${meaning}`);
        hi.push(`अर्थ: ${meaning}`);
      }
      if (warn) {
        hi.push(`नोट: ${warn}`);
        en.push(`Note: ${warn}`);
      }
      subs = [
        {
          title_hi: "पूर्ण सूत्र",
          title_en: "Full sutra",
          description_hi: hi.join("\n\n") || null,
          description_en: en.join("\n\n") || null,
        },
      ];
    }

    const punya = Math.min(1000, Math.max(10, 10 * subs.length));
    sections.push({
      order_index: order,
      title_hi: titles.hi,
      title_en: titles.en,
      punya_points: punya,
      subsections: subs.map((s, i) => ({ ...s, order_index: i })),
    });
  }
  return sections;
}

async function main() {
  const md = fs.readFileSync(MD_PATH, "utf8");
  const sections = parseMarkdown(md);
  if (sections.length === 0) {
    throw new Error("No sections parsed from markdown.");
  }

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");

    // Avoid duplicate active Jain Sutras from re-runs
    await client.query(
      `UPDATE courses SET deleted_at = NOW(), updated_at = NOW()
       WHERE deleted_at IS NULL AND name_en = 'Jain Sutras'`,
    );

    const coursePunya = Math.min(
      2000,
      sections.reduce((sum, s) => sum + s.punya_points, 0),
    );

    const { rows: [course] } = await client.query(
      `INSERT INTO courses (city_id, name_en, name_hi, kind, academic_year, status, punya_points)
       VALUES ($1, $2, $3, 'standard', $4, 'active', $5)
       RETURNING id`,
      [CITY_ID, "Jain Sutras", "जैन सूत्र", ACADEMIC_YEAR, coursePunya],
    );

    let subCount = 0;
    for (const sec of sections) {
      const { rows: [section] } = await client.query(
        `INSERT INTO course_sections (course_id, title_en, title_hi, order_index, punya_points)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [course.id, sec.title_en, sec.title_hi, sec.order_index, sec.punya_points],
      );
      for (const sub of sec.subsections) {
        await client.query(
          `INSERT INTO course_subsections
             (section_id, title_en, title_hi, description_en, description_hi, order_index)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            section.id,
            sub.title_en,
            sub.title_hi,
            sub.description_en,
            sub.description_hi,
            sub.order_index,
          ],
        );
        subCount += 1;
      }
    }

    await client.query("COMMIT");
    console.log(
      JSON.stringify(
        {
          course_id: course.id,
          name_en: "Jain Sutras",
          name_hi: "जैन सूत्र",
          status: "active",
          sections: sections.length,
          subsections: subCount,
          section_titles: sections.map((s) => `${s.order_index + 1}. ${s.title_en} (${s.subsections.length} subs)`),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
