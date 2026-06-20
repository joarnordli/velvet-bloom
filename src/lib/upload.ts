import { stripImageMetadata } from "./strip-exif";
import { createPostMediaUpload } from "./uploads.functions";

/**
 * Upload pipeline for the FAB "Last opp" and "Kamera" actions.
 *
 * Invariant: metadata is stripped client-side BEFORE the upload. If
 * stripImageMetadata throws, the PUT is never reached — original EXIF bytes
 * never leave the device. Storage is Cloudflare R2: we ask the server for a
 * short-lived presigned PUT URL (auth-gated) and upload the sanitized blob to it.
 */
export async function uploadPostMedia(file: File): Promise<{ path: string }> {
  // Hard gate: only images allowed. Other formats (HEIC/RAW/video) carry
  // metadata we can't reliably scrub in the browser.
  if (!file.type.startsWith("image/")) {
    throw new Error("Kun bildefiler er tillatt.");
  }

  // 1. Strip EXIF / GPS / device metadata via canvas re-encode.
  const clean = await stripImageMetadata(file);

  // 2. Ask the server for a presigned PUT (it derives the key from the session).
  const { key, url } = await createPostMediaUpload({
    data: { contentType: clean.mimeType },
  });

  // 3. Upload the SANITIZED blob straight to R2 — never the original File.
  const res = await fetch(url, {
    method: "PUT",
    body: clean.blob,
    headers: { "content-type": clean.mimeType },
  });
  if (!res.ok) {
    throw new Error(`Opplasting feilet (${res.status}).`);
  }

  return { path: key };
}
