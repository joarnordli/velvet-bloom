/**
 * Strip ALL EXIF / GPS / device metadata from an image file by re-encoding it
 * through an HTML5 canvas. Output is a clean Blob with no metadata.
 *
 * Privacy contract: ANY user-supplied image MUST pass through this helper
 * before being sent to Supabase Storage. Bytes that leave the device must
 * not carry GPS, camera serial numbers, timestamps, or thumbnail leaks.
 */
export type StrippedImage = {
  blob: Blob;
  mimeType: "image/jpeg" | "image/png";
  extension: "jpg" | "png";
};

export async function stripImageMetadata(
  file: File,
  options: { quality?: number } = {},
): Promise<StrippedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Filen er ikke et bilde.");
  }

  const { quality = 0.9 } = options;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Kunne ikke lese filen."));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Kunne ikke dekode bildet."));
    i.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D-konteksten er ikke tilgjengelig.");

  // Drawing into a fresh canvas drops every chunk Chrome's image decoder did
  // not put on the pixel grid: EXIF, XMP, IPTC, ICC profiles, GPS, timestamps,
  // device makes, thumbnails. The re-encoded output below is metadata-free.
  ctx.drawImage(img, 0, 0);

  // PNG for sources with alpha; JPEG otherwise (smaller, no transparency need).
  const needsAlpha = /png|webp|gif|avif/i.test(file.type);
  const mimeType: "image/jpeg" | "image/png" = needsAlpha
    ? "image/png"
    : "image/jpeg";

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Kunne ikke kode om bildet."))),
      mimeType,
      mimeType === "image/jpeg" ? quality : undefined,
    );
  });

  return { blob, mimeType, extension: mimeType === "image/png" ? "png" : "jpg" };
}
