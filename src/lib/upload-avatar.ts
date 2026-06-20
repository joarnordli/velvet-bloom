import { stripImageMetadata } from "./strip-exif";
import { createAvatarUpload } from "./uploads.functions";

/**
 * Upload a new avatar to Cloudflare R2 (key prefix `avatars/`). Strips EXIF
 * first, then uploads via a server-issued presigned PUT. Returns the object key
 * which is written to profiles.avatar_path.
 */
export async function uploadAvatar(file: File): Promise<{ path: string }> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Kun bildefiler er tillatt.");
  }
  const clean = await stripImageMetadata(file);

  const { key, url } = await createAvatarUpload({
    data: { contentType: clean.mimeType },
  });

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
