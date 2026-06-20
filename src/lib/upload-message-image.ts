import { stripImageMetadata } from "./strip-exif";
import { createMessageImageUpload } from "./uploads.functions";

/**
 * Upload a chat image attachment to Cloudflare R2 (key prefix `message-media/`).
 *
 * Invariant: EXIF / GPS / device metadata is stripped client-side BEFORE the
 * upload (see strip-exif.ts). The server issues the presigned PUT only after
 * verifying the caller is a member of the target conversation, and scopes the
 * key under `message-media/{conversationId}/...`.
 */
export type UploadedMessageImage = {
  storagePath: string;
  mime: "image/jpeg" | "image/png";
  width: number;
  height: number;
};

export async function uploadMessageImage(
  file: File,
  conversationId: string,
): Promise<UploadedMessageImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Kun bildefiler er tillatt.");
  }

  const clean = await stripImageMetadata(file);

  // Read dimensions from the sanitized blob so we can render with stable size.
  const dims = await readImageDimensions(clean.blob);

  const { key, url } = await createMessageImageUpload({
    data: { contentType: clean.mimeType, conversationId },
  });

  const res = await fetch(url, {
    method: "PUT",
    body: clean.blob,
    headers: { "content-type": clean.mimeType },
  });
  if (!res.ok) {
    throw new Error(`Opplasting feilet (${res.status}).`);
  }

  return {
    storagePath: key,
    mime: clean.mimeType,
    width: dims.width,
    height: dims.height,
  };
}

async function readImageDimensions(
  blob: Blob,
): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () =>
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("Kunne ikke lese bildedimensjoner."));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
