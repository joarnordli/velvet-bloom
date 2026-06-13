import { supabase } from "@/integrations/supabase/client";
import { stripImageMetadata } from "./strip-exif";

/**
 * Upload a chat image attachment.
 *
 * Invariant: EXIF / GPS / device metadata is stripped client-side BEFORE the
 * storage call (see strip-exif.ts). Storage RLS scopes uploads to members of
 * the target conversation via `is_conversation_member` on the first path
 * segment, so we MUST place the file under `{conversationId}/...`.
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

  const path = `${conversationId}/${crypto.randomUUID()}.${clean.extension}`;

  const { error } = await supabase.storage
    .from("message-media")
    .upload(path, clean.blob, {
      contentType: clean.mimeType,
      upsert: false,
      cacheControl: "3600",
    });

  if (error) throw new Error(error.message);

  return {
    storagePath: path,
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
