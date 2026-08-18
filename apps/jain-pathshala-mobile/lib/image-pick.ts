/**
 * The only place the app opens the photo library or the camera.
 *
 * WHY A WRAPPER RATHER THAN AN OPTION EVERYONE REMEMBERS
 *
 * iOS stores camera photos as HEIC. `expo-image-picker` defaults
 * `preferredAssetRepresentationMode` to `.current`, and its HEIC branch is a
 * straight passthrough — `case UTType.heic.identifier: return (rawData, ".heic")`
 * (ios/ImageUtils.swift). `quality` does NOT re-encode on that branch, so the
 * raw HEIC goes up, and the server cannot read it: sharp's prebuilt libvips
 * carries libheif with AV1 only, no HEVC decoder. Registration photos were
 * rejected while screenshots (PNG) sailed through.
 *
 * The option was already set correctly in three files and missing from five.
 * That is the failure mode this module exists to end: an absent key in an
 * object literal typechecks, passes every test, and only breaks on one platform
 * with one file format. `lib/__tests__/image-pick-guard.test.ts` asserts no
 * other file calls the picker directly.
 *
 * ANDROID reaches the same place by a different road: MediaHandler.kt picks
 * `CompressionImageExporter` whenever `quality < 1`, which decodes through the
 * platform codec and re-encodes to JPEG. `preferredAssetRepresentationMode` is
 * iOS-only, so on Android that quality rule is the whole defence — hence
 * DEFAULT_QUALITY below and the assertion that guards it.
 */
import * as ImagePicker from "expo-image-picker";

/**
 * Force a JPEG/H.264-compatible representation on iOS. If this enum disappears
 * after an SDK bump, optional chaining would silently pass `undefined` and iOS
 * would fall back to Current (raw HEIC) — the exact bug, reintroduced quietly.
 */
export const PREFERRED_ASSET_REPRESENTATION_MODE =
  ImagePicker.UIImagePickerPreferredAssetRepresentationMode?.Compatible;

if (__DEV__ && PREFERRED_ASSET_REPRESENTATION_MODE === undefined) {
  throw new Error(
    "[image-pick] UIImagePickerPreferredAssetRepresentationMode.Compatible is undefined. " +
      "iOS would upload raw HEIC. Check the expo-image-picker version.",
  );
}

/**
 * Below 1 on purpose. At exactly 1 Android switches to RawImageExporter and
 * passes a HEIF file through untouched, which this server cannot read either.
 */
export const DEFAULT_QUALITY = 0.85;

export type PickMediaOptions = {
  source: "library" | "camera";
  mediaTypes: ImagePicker.MediaType[];
  /** Must stay below 1 — see DEFAULT_QUALITY. */
  quality?: number;
  allowsEditing?: boolean;
  aspect?: [number, number];
  videoMaxDuration?: number;
};

/**
 * Open the library or camera and return the chosen asset, or `null` when the
 * user backed out — so callers keep their `if (!asset) return` shape instead of
 * unpacking `canceled` / `assets[0]` twelve times over.
 */
export async function pickMediaAsset(
  opts: PickMediaOptions,
): Promise<ImagePicker.ImagePickerAsset | null> {
  const quality = opts.quality ?? DEFAULT_QUALITY;
  if (__DEV__ && quality >= 1) {
    throw new Error(
      `[image-pick] quality must be below 1 (got ${quality}). At 1 Android returns the ` +
        "original file, so a HEIF photo would upload raw and be rejected.",
    );
  }

  const shared = {
    mediaTypes: opts.mediaTypes,
    quality,
    preferredAssetRepresentationMode: PREFERRED_ASSET_REPRESENTATION_MODE,
    ...(opts.allowsEditing === undefined ? {} : { allowsEditing: opts.allowsEditing }),
    ...(opts.aspect === undefined ? {} : { aspect: opts.aspect }),
    ...(opts.videoMaxDuration === undefined
      ? {}
      : { videoMaxDuration: opts.videoMaxDuration }),
  } satisfies ImagePicker.ImagePickerOptions;

  const result =
    opts.source === "camera"
      ? await ImagePicker.launchCameraAsync(shared)
      : await ImagePicker.launchImageLibraryAsync(shared);

  if (result.canceled) return null;
  return result.assets[0] ?? null;
}
