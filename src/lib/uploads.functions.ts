import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "./auth-middleware";
import { presignUpload } from "./storage.server";
import { isConversationMember } from "./authz.server";

/**
 * Presigned-upload issuers. The browser strips EXIF, asks one of these for a
 * short-lived PUT URL (auth + membership enforced here), uploads the blob
 * straight to R2, then stores the returned `key` in the relevant *_path column.
 *
 * Only image/jpeg and image/png are allowed — the client re-encodes to one of
 * these in strip-exif.ts, so anything else is a tampered request.
 */
const IMAGE_MIME = z.enum(["image/jpeg", "image/png"]);
const EXT_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

function rand(): string {
  return crypto.randomUUID();
}

/** Upload URL for a feed post image → key `post-media/{userId}/{uuid}.{ext}`. */
export const createPostMediaUpload = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ contentType: IMAGE_MIME }).parse(d))
  .handler(async ({ data, context }): Promise<{ key: string; url: string }> => {
    const key = `post-media/${context.userId}/${rand()}.${EXT_FOR_MIME[data.contentType]}`;
    const url = await presignUpload(key, data.contentType);
    return { key, url };
  });

/** Upload URL for an avatar → key `avatars/{userId}/avatar-{ts}.{ext}`. */
export const createAvatarUpload = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ contentType: IMAGE_MIME }).parse(d))
  .handler(async ({ data, context }): Promise<{ key: string; url: string }> => {
    const key = `avatars/${context.userId}/avatar-${Date.now()}.${EXT_FOR_MIME[data.contentType]}`;
    const url = await presignUpload(key, data.contentType);
    return { key, url };
  });

/** Upload URL for a chat image → key `message-media/{conversationId}/{uuid}.{ext}`. */
export const createMessageImageUpload = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({ contentType: IMAGE_MIME, conversationId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ key: string; url: string }> => {
    if (!(await isConversationMember(data.conversationId, context.userId))) {
      throw new Error("Du er ikke medlem av denne samtalen.");
    }
    const key = `message-media/${data.conversationId}/${rand()}.${EXT_FOR_MIME[data.contentType]}`;
    const url = await presignUpload(key, data.contentType);
    return { key, url };
  });
