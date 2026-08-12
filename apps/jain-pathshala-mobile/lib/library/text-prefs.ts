import AsyncStorage from "@react-native-async-storage/async-storage";

export const TEXT_FONT_SIZE_KEY = "jp.library.text_font_size";
export const TEXT_FONT_SIZE_DEFAULT = 16;
export const TEXT_FONT_SIZE_MIN = 14;
export const TEXT_FONT_SIZE_MAX = 28;
export const TEXT_FONT_SIZE_STEP = 2;

export function clampTextFontSize(n: number): number {
  const stepped = Math.round(n / TEXT_FONT_SIZE_STEP) * TEXT_FONT_SIZE_STEP;
  return Math.min(TEXT_FONT_SIZE_MAX, Math.max(TEXT_FONT_SIZE_MIN, stepped));
}

export async function readTextFontSize(): Promise<number> {
  const raw = await AsyncStorage.getItem(TEXT_FONT_SIZE_KEY);
  if (!raw) return TEXT_FONT_SIZE_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return TEXT_FONT_SIZE_DEFAULT;
  return clampTextFontSize(n);
}

export async function writeTextFontSize(size: number): Promise<number> {
  const next = clampTextFontSize(size);
  await AsyncStorage.setItem(TEXT_FONT_SIZE_KEY, String(next));
  return next;
}
