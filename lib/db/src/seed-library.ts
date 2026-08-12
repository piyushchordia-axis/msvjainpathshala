/**
 * Library-only reseed — replaces library_sections / subsections / items
 * without truncating the rest of the database.
 *
 * Run: pnpm --filter @workspace/db run seed:library
 * Requires DATABASE_URL (e.g. postgres://jp:jp_dev_pwd@localhost:5434/jainpathshala).
 */
import { db, pool } from "./index";
import { seedLibraryContent } from "./seed-library-content";

async function main() {
  const result = await seedLibraryContent(db, { replace: true });
  console.log(
    `Library reseeded: ${result.sectionIds.length} sections, subsection ${result.subsectionId}, items [${result.itemCodes.join(", ")}]`,
  );
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
