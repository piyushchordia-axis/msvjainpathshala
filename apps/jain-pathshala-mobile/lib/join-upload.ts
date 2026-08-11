import { Platform } from "react-native";
import { API_BASE, ApiError, type UploadFileInput, type UploadResult } from "@/lib/api";

const REQUEST_TIMEOUT_MS = 30_000;

/** Ensure a filename with an image extension — iOS often omits fileName. */
export function safeImageUploadName(name: string | null | undefined, uri?: string): string {
  const fromName = name?.trim();
  if (fromName && /\.[a-z0-9]{2,4}$/i.test(fromName)) return fromName;
  const fromUri = uri?.split("?")[0]?.split("/").pop();
  if (fromUri && /\.[a-z0-9]{2,4}$/i.test(fromUri)) return fromUri;
  return "photo.jpg";
}

/** Never send an empty MIME — multer/iOS HEIC often leave mimeType undefined. */
export function safeImageMime(type: string | null | undefined): string {
  const t = (type || "").split(";")[0]!.trim().toLowerCase();
  if (t.startsWith("image/")) return t;
  return "image/jpeg";
}

/** Public multipart upload for join/gan registration (no auth). */
export async function joinUpload(file: UploadFileInput): Promise<UploadResult> {
  if (!API_BASE) {
    throw new ApiError("ERR_CONFIG", "API URL is not configured.", 0);
  }
  const form = new FormData();
  const mime = safeImageMime(file.type);
  const safeName = safeImageUploadName(file.name, file.uri);

  if (file.blob) {
    form.append("file", file.blob, safeName);
  } else if (Platform.OS === "web") {
    const blobRes = await fetch(file.uri);
    const blob = await blobRes.blob();
    form.append("file", blob, safeName);
  } else {
    form.append("file", {
      uri: file.uri,
      name: safeName,
      type: mime,
    } as unknown as Blob);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/join/uploads`, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: form,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const json = (await res.json()) as {
    data?: UploadResult;
    error?: { code: string; message: string };
  };
  if (!res.ok) {
    throw new ApiError(
      json.error?.code ?? "ERR_UPLOAD",
      json.error?.message ?? "Upload failed — choose a clear image and try again.",
      res.status,
    );
  }
  return json.data!;
}
