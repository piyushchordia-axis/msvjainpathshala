/**
 * Regression: createBilingual must work from an esbuild bundle with
 * `loader: { ".ttf": "binary" }` — the same path production uses.
 * Vitest-in-place resolution is not evidence the feature works.
 */
import { afterAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pdfSrc = path.resolve(here, "../src/lib/pdf.ts");

describe("PdfBuilder.createBilingual (built artifact)", () => {
  let outdir: string | undefined;

  afterAll(async () => {
    if (outdir) await rm(outdir, { recursive: true, force: true });
  });

  it("embeds Devanagari and produces a PDF after esbuild binary-loader bundle", async () => {
    outdir = await mkdtemp(path.join(tmpdir(), "jp-pdf-bilingual-"));
    const entry = path.join(outdir, "entry.mjs");
    const outfile = path.join(outdir, "smoke.mjs");

    // Relative import from a temp entry keeps esbuild resolving the .ttf beside pdf.ts.
    await writeFile(
      entry,
      `import { PdfBuilder, assertDevanagariFontAvailable } from ${JSON.stringify(pdfSrc)};
export async function smoke() {
  assertDevanagariFontAvailable();
  const b = await PdfBuilder.createBilingual();
  b.bilingual("Centre monthly report", "केंद्र मासिक रिपोर्ट");
  const buf = await b.toBuffer();
  return buf.byteLength;
}
`,
      "utf8",
    );

    const { readFile } = await import("node:fs/promises");
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      // Same inlining strategy as apps/api-server/build.mjs (Buffer base64 — not
      // Uint8Array.fromBase64, which Node 22–24 lack).
      plugins: [
        {
          name: "ttf-binary",
          setup(b) {
            b.onLoad({ filter: /\.ttf$/ }, async (args) => {
              const b64 = (await readFile(args.path)).toString("base64");
              return {
                contents: `export default new Uint8Array(Buffer.from(${JSON.stringify(b64)}, "base64"));`,
                loader: "js",
              };
            });
          },
        },
      ],
      // Match production: fontkit / pdf-lib / regenerator are inlined.
      packages: "bundle",
      logLevel: "silent",
    });

    const bundledSize = statSync(outfile).size;
    // Font alone is ~219 KB; a successful inline pushes the smoke bundle well above that.
    expect(bundledSize).toBeGreaterThan(200_000);

    const mod = (await import(pathToFileURL(outfile).href)) as {
      smoke: () => Promise<number>;
    };
    const pdfLen = await mod.smoke();
    expect(pdfLen).toBeGreaterThan(1_000);
  });
});
