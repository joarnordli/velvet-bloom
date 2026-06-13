import { supabase } from "@/integrations/supabase/client";
import { stripImageMetadata } from "./strip-exif";

/**
 * Upload pipeline for the FAB "Last opp" and "Kamera" actions.
 *
 * Invariant: metadata is stripped client-side BEFORE the storage call.
 * If stripImageMetadata throws, the supabase.storage.upload line is never
 * reached — so original EXIF bytes never leave the device.
 */
export async function uploadPostMedia(file: File): Promise<{ path: string }> {
  // Hard gate: only images allowed. Other formats (HEIC/RAW/video) carry
  // metadata we can't reliably scrub in the browser.
  if (!file.type.startsWith("image/")) {
    throw new Error("Kun bildefiler er tillatt.");
  }

  // 1. Strip EXIF / GPS / device metadata via canvas re-encode.
  const clean = await stripImageMetadata(file);

  // 2. Resolve current user (storage RLS scopes uploads to the user's folder).
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    throw new Error("Du må være logget inn for å laste opp.");
  }

  const path = `${userData.user.id}/${crypto.randomUUID()}.${clean.extension}`;

  // 3. Upload the SANITIZED blob — never the original File.
  const { error: uploadErr } = await supabase.storage
    .from("post-media")
    .upload(path, clean.blob, {
      contentType: clean.mimeType,
      upsert: false,
      cacheControl: "3600",
    });

  if (uploadErr) {
    throw new Error(uploadErr.message);
  }

  return { path };
}
