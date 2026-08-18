/**
 * Guard: the photo library and camera are opened in exactly one place.
 *
 * This exists because of a shipped bug. `expo-image-picker` defaults
 * `preferredAssetRepresentationMode` to `.current`, and its iOS HEIC branch is a
 * passthrough — `case UTType.heic.identifier: return (rawData, ".heic")`. Without
 * that option an iPhone hands over the raw HEIC, which the server cannot read
 * (sharp's prebuilt libvips carries libheif with AV1 only, no HEVC decoder). So
 * registration rejected every camera photo while screenshots, being PNG, worked.
 *
 * The option was present in three files and missing from five. Nothing could
 * catch that: an absent key in an object literal typechecks, passes every test,
 * and fails only on one platform with one file format. A per-call-site option
 * is not a rule — a single entry point is.
 *
 * `lib/image-pick.ts` cannot be imported here (it reaches expo-image-picker and
 * through it react-native's Flow syntax, which the test bundler cannot parse),
 * so the guard reads source. That suits it: what is being asserted is the
 * absence of a call, which no runtime test can establish.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(HERE, "..", "..");

/** The single sanctioned wrapper, relative to APP_ROOT. */
const PICKER_MODULE = "lib/image-pick.ts";

/** Calls that open a picker and therefore need the representation mode. */
const LAUNCH_CALLS = ["launchImageLibraryAsync", "launchCameraAsync"] as const;

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

/** Repo-relative, forward-slashed, so failure messages are clickable. */
function rel(file: string): string {
  return relative(APP_ROOT, file).split(sep).join("/");
}

describe("image picker entry point", () => {
  const files = SCANNED_DIRS.flatMap((d) => sourceFiles(join(APP_ROOT, d)));

  it("scans the app source tree", () => {
    // A path change that silently emptied the scan would make every assertion
    // below pass while checking nothing.
    expect(files.length).toBeGreaterThan(100);
  });

  for (const call of LAUNCH_CALLS) {
    it(`only ${PICKER_MODULE} calls ${call}`, () => {
      const callers = files
        .filter((f) => rel(f) !== PICKER_MODULE)
        .filter((f) => new RegExp(`\\b${call}\\s*\\(`).test(readFileSync(f, "utf8")))
        .map(rel);

      expect({ call, calledOutsideWrapperBy: callers }).toEqual({
        call,
        calledOutsideWrapperBy: [],
      });
    });
  }

  const wrapper = readFileSync(join(APP_ROOT, PICKER_MODULE), "utf8");

  it("the wrapper passes preferredAssetRepresentationMode on every launch", () => {
    // The whole point of routing every caller here. If this key goes missing,
    // iOS silently reverts to Current and ships raw HEIC again.
    expect(wrapper).toMatch(
      /preferredAssetRepresentationMode:\s*PREFERRED_ASSET_REPRESENTATION_MODE/,
    );
    // Both launches must read the same options object, not two literals that
    // can drift apart.
    for (const call of LAUNCH_CALLS) {
      expect(wrapper).toMatch(new RegExp(`${call}\\(shared\\)`));
    }
  });

  it("the wrapper refuses quality >= 1", () => {
    // Android's defence is different and just as load-bearing: MediaHandler.kt
    // uses RawImageExporter at exactly quality 1, passing a HEIF file through
    // untouched. preferredAssetRepresentationMode is iOS-only and cannot help
    // there, so the quality rule is all that stands between Android and the
    // same bug.
    expect(wrapper).toMatch(/quality\s*>=\s*1/);
    expect(wrapper).toMatch(/DEFAULT_QUALITY\s*=\s*0\.\d+/);
  });

  it("detects the shape it is meant to detect", () => {
    // Without this the regexes could quietly stop matching and the guard would
    // pass forever on a broken tree.
    const call = /\blaunchCameraAsync\s*\(/;
    expect(call.test(`await ImagePicker.launchCameraAsync({ mediaTypes: ["images"] })`)).toBe(
      true,
    );
    expect(call.test(`const f = launchCameraAsync ({})`)).toBe(true);
    // Prose naming the call must not trip it.
    expect(call.test(`// launchCameraAsync is wrapped by pickMediaAsset`)).toBe(false);
  });
});
