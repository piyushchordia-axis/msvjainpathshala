/**
 * The ways a child can attach proof to a niyam, in the order they are offered.
 *
 * These used to be inline buttons with `minWidth: 96–120` in a wrapping row.
 * `proof_type` defaults to 'either' (four sources) and 'any' gives five, so the
 * crowded case was the norm, not the exception — the row stacked three deep and
 * worse in Hindi, where CLAUDE.md budgets +35% string length. They are now
 * listed in a sheet, which also buys room for a real label instead of
 * "Video cam".
 *
 * Pure, so it can be tested: the mobile test bundler cannot parse react-native.
 */

export type ProofSourceKey =
  | "photo_camera"
  | "photo_library"
  | "video_camera"
  | "video_library"
  | "audio_record";

export type ProofSource = {
  key: ProofSourceKey;
  labelEn: string;
  labelHi: string;
  /** Ionicons glyph name. */
  icon: "camera-outline" | "images-outline" | "videocam-outline" | "film-outline" | "mic-outline";
};

const PHOTO_CAMERA: ProofSource = {
  key: "photo_camera",
  labelEn: "Take a photo",
  labelHi: "फोटो लें",
  icon: "camera-outline",
};
const PHOTO_LIBRARY: ProofSource = {
  key: "photo_library",
  labelEn: "Choose a photo",
  labelHi: "गैलरी से फोटो चुनें",
  icon: "images-outline",
};
const VIDEO_CAMERA: ProofSource = {
  key: "video_camera",
  labelEn: "Record a video",
  labelHi: "वीडियो रिकॉर्ड करें",
  icon: "videocam-outline",
};
const VIDEO_LIBRARY: ProofSource = {
  key: "video_library",
  labelEn: "Choose a video",
  labelHi: "गैलरी से वीडियो चुनें",
  icon: "film-outline",
};
const AUDIO_RECORD: ProofSource = {
  key: "audio_record",
  labelEn: "Record audio",
  labelHi: "ऑडियो रिकॉर्ड करें",
  icon: "mic-outline",
};

/**
 * Mirrors `allowedKinds` in NiyamProofPicker — the media kinds a proof_type
 * permits — and expands each into the concrete places media can come from.
 */
export function proofSources(proofType: string): ProofSource[] {
  const photo = [PHOTO_CAMERA, PHOTO_LIBRARY];
  const video = [VIDEO_CAMERA, VIDEO_LIBRARY];
  if (proofType === "photo") return photo;
  if (proofType === "video") return video;
  if (proofType === "audio") return [AUDIO_RECORD];
  if (proofType === "any") return [...photo, ...video, AUDIO_RECORD];
  // 'either' and anything unrecognised — the column default is 'either'.
  return [...photo, ...video];
}

/**
 * With exactly one source there is nothing to choose, so the button acts
 * directly and no sheet appears. Asking a child to pick from a list of one is
 * a tap that buys nothing.
 */
export function proofSourceNeedsSheet(sources: ProofSource[]): boolean {
  return sources.length > 1;
}

export function proofSourceLabel(source: ProofSource, hi: boolean): string {
  return hi ? source.labelHi : source.labelEn;
}
