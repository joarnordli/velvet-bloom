import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Cloudflare R2 object storage (S3-compatible). Replaces Supabase Storage's three
 * private buckets — now one private bucket (`R2_BUCKET`) with key prefixes:
 *   avatars/…  post-media/…  message-media/…
 *
 * Server-only: R2 credentials are secret, so the browser never talks to R2
 * directly. Uploads go through presigned PUT URLs (issued by uploads.functions.ts
 * after auth/membership checks); reads go through short-lived presigned GET URLs.
 * The full object key is what gets stored in the *_path columns.
 */

function env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set — required for Cloudflare R2 storage.`);
  return v;
}

let _client: S3Client | undefined;
function client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: "auto",
      endpoint: env("R2_ENDPOINT"),
      credentials: {
        accessKeyId: env("R2_ACCESS_KEY_ID"),
        secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return _client;
}

function bucket(): string {
  return env("R2_BUCKET");
}

/** Presigned PUT URL for a one-shot client upload (default 5 min). */
export async function presignUpload(
  key: string,
  contentType: string,
  expiresIn = 300,
): Promise<string> {
  return getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
    { expiresIn },
  );
}

/** Presigned GET URL for a private object (default 1 hour). */
export async function presignDownload(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn },
  );
}

/**
 * Batch variant of presignDownload — returns a key→url map. Mirrors the old
 * `supabase.storage.createSignedUrls(paths, ttl)` used across the *.functions.ts.
 * Null/empty/duplicate keys are de-duped; failures are omitted (best-effort).
 */
export async function presignDownloadMany(
  keys: Array<string | null | undefined>,
  expiresIn = 3600,
): Promise<Record<string, string>> {
  const unique = [...new Set(keys.filter((k): k is string => !!k))];
  const out: Record<string, string> = {};
  await Promise.all(
    unique.map(async (key) => {
      try {
        out[key] = await presignDownload(key, expiresIn);
      } catch {
        /* best-effort: skip keys that fail to sign */
      }
    }),
  );
  return out;
}

/** Delete an object (e.g. when an avatar/post is replaced or removed). */
export async function deleteObject(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
