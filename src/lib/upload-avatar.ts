import { supabase } from "@/integrations/supabase/client";
import { stripImageMetadata } from "./strip-exif";

/**
 * Upload a new avatar to the private `avatars` bucket. Strips EXIF first.
 * Returns the storage path which is then written to profiles.avatar_path.
 */
export async function uploadAvatar(file: File): Promise<{ path: string }> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Kun bildefiler er tillatt.");
  }
  const clean = await stripImageMetadata(file);

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    throw new Error("Du må være logget inn.");
  }

  const path = `${userData.user.id}/avatar-${Date.now()}.${clean.extension}`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, clean.blob, {
      contentType: clean.mimeType,
      upsert: false,
      cacheControl: "3600",
    });
  if (error) throw new Error(error.message);
  return { path };
}
