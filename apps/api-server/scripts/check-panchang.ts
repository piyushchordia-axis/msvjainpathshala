/**
 * Validate a transcribed Panchang year file before anyone uploads it.
 *
 *   pnpm --filter @workspace/api-server run panchang:check <file.json>
 *
 * Runs exactly the two checks the publish route runs — the schema (which
 * requires provenance naming a verifier, §17.6.1) and the anchor rules — so a
 * transcription can be corrected against the printed Panchang before it reaches
 * the admin panel at all.
 *
 * A clean result is NOT a statement that the year is right. It means the file
 * does not contradict the handful of things software can check. Whether the
 * tithis are the Panchang's tithis is the verifier's judgement, and nothing here
 * substitutes for it.
 */
import { readFileSync } from "node:fs";
import {
  panchangAnchorIssues,
  panchangYearSchema,
} from "@workspace/api-zod";

function main(): number {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: panchang:check <file.json>");
    return 2;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`Could not read ${file}: ${err instanceof Error ? err.message : err}`);
    return 2;
  }

  const parsed = panchangYearSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`${file} does not parse as a Panchang year:\n`);
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    console.error(
      "\nIf the complaint is about `provenance`: every year must record the printed" +
        "\nPanchang it came from, who transcribed it, and who verified it (§17.6.1).",
    );
    return 1;
  }

  const year = parsed.data;
  const issues = panchangAnchorIssues(year);
  const days = year.days.length;
  const events = year.days.reduce((n, d) => n + d.events.length, 0);

  console.log(`${file}`);
  console.log(`  year        ${year.year ?? "(unset)"} · ${year.sect}`);
  console.log(`  days        ${days}`);
  console.log(`  events      ${events}`);
  console.log(`  verified by ${year.provenance.verified_by} on ${year.provenance.verified_at}`);
  console.log(`  source      ${year.provenance.source_publication} (${year.provenance.source_year})`);
  console.log("");

  if (issues.length === 0) {
    console.log("No rule violations found.");
    console.log(
      "This does not mean the year is correct — only that it contradicts none of\n" +
        "the anchors. Correctness rests on the verification above.",
    );
    return 0;
  }

  console.error(`${issues.length} rule violation(s) — publishing will be refused:\n`);
  for (const issue of issues) {
    console.error(`  ${issue.rule}  ${issue.message}`);
  }
  return 1;
}

process.exit(main());
