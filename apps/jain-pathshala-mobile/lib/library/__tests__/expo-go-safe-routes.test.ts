/**
 * Guard: no app code statically imports a module that cannot initialise in Expo Go.
 *
 * This exists because of a real outage, not a hypothetical. `react-native-pdf`
 * was imported at the top of `app/library/pdf/[itemId].tsx`. It pulls in
 * `react-native-blob-util`, which builds a `NativeEventEmitter` over a native
 * module DURING MODULE INITIALISATION — and Expo Go ships no custom native
 * modules, so that throws.
 *
 * The damage was not a broken PDF screen. Expo Router requires every route
 * module when a navigator builds its screen config, and that route is on the
 * ROOT stack, so the import ran at launch: the app died before first paint and
 * sign-in, attendance and everything else went with it. One line in a leaf
 * screen nobody had navigated to.
 *
 * Nothing else can catch this. It typechecks, every unit test passes, and the
 * web build is unaffected — it only shows up on a device, as a total failure.
 * A dynamic `import()` behind an `isExpoGo` check is the supported way to use
 * these packages (see `lib/library/pdf-view.ts`); a static import never is.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `new URL(".", import.meta.url)` resolves to the DOM URL under Expo's tsconfig
// lib, which node:url rejects — go through fileURLToPath on the module path.
const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(HERE, "..", "..", "..");

/**
 * Packages whose module init touches a native module. Add to this list when a
 * dependency turns out to need a custom native build, with the reason — the
 * next person needs to know whether their new package belongs here.
 */
const NATIVE_ONLY_PACKAGES: Array<{ pkg: string; why: string }> = [
  {
    pkg: "react-native-pdf",
    why: "requires react-native-blob-util, which throws during module init",
  },
  {
    pkg: "react-native-blob-util",
    why: "constructs a NativeEventEmitter over a native module at module scope",
  },
];

/** Directories whose modules are reachable from a route, so from app launch. */
const SCANNED_DIRS = ["app", "components", "contexts", "hooks", "lib"];

const SOURCE_EXT = /\.tsx?$/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (SOURCE_EXT.test(entry)) out.push(full);
  }
  return out;
}

/**
 * A static `import`/`export … from "pkg"`, or a bare side-effect `import "pkg"`.
 *
 * `import type … from "pkg"` is deliberately NOT a match: TypeScript erases it,
 * so it emits no require and cannot run anything. That is how `pdf-view.ts`
 * keeps full typing while resolving the component dynamically.
 */
function staticImportOf(pkg: string, source: string): boolean {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fromForm = new RegExp(
    String.raw`(?:^|[\n;])\s*(?:import|export)\b([^;'"]*?)\bfrom\s*['"]${escaped}['"]`,
  );
  const sideEffectForm = new RegExp(
    String.raw`(?:^|[\n;])\s*import\s*['"]${escaped}['"]`,
  );
  const match = fromForm.exec(source);
  if (match && !/\btype\b/.test(match[1] ?? "")) return true;
  return sideEffectForm.test(source);
}

describe("Expo Go launch safety", () => {
  const files = SCANNED_DIRS.flatMap((d) => sourceFiles(join(APP_ROOT, d)));

  it("scans the app source tree", () => {
    // A path or extension change that silently emptied the scan would make
    // every assertion below pass while checking nothing.
    expect(files.length).toBeGreaterThan(100);
  });

  for (const { pkg, why } of NATIVE_ONLY_PACKAGES) {
    it(`no static import of ${pkg} (${why})`, () => {
      const offenders = files
        .filter((f) => staticImportOf(pkg, readFileSync(f, "utf8")))
        .map((f) => relative(APP_ROOT, f).split(sep).join("/"));

      // Named so the failure message says what to do, not just what broke.
      expect({ package: pkg, staticallyImportedBy: offenders }).toEqual({
        package: pkg,
        staticallyImportedBy: [],
      });
    });
  }

  it("detects the shape it is meant to detect", () => {
    // Without this the regex could quietly stop matching and the guard would
    // pass forever on a broken tree.
    expect(staticImportOf("react-native-pdf", `import Pdf from "react-native-pdf";`)).toBe(true);
    expect(staticImportOf("react-native-pdf", `import "react-native-pdf";`)).toBe(true);
    expect(
      staticImportOf("react-native-pdf", `export { default } from "react-native-pdf";`),
    ).toBe(true);
    expect(
      staticImportOf("react-native-pdf", `import {\n  a,\n  b,\n} from "react-native-pdf";`),
    ).toBe(true);

    // Allowed: erased at compile time, or resolved at call time.
    expect(staticImportOf("react-native-pdf", `import type P from "react-native-pdf";`)).toBe(
      false,
    );
    expect(staticImportOf("react-native-pdf", `await import("react-native-pdf");`)).toBe(false);
    // Prose naming the package must not trip it.
    expect(staticImportOf("react-native-pdf", `// react-native-pdf is loaded lazily`)).toBe(false);
  });
});
