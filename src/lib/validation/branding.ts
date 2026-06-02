import { z } from "zod";

// S12 — logo upload guard (AC-12.1). Keyed by extension → MIME type. Image-only
// and small: a header logo, not a document. Mirrors validation/documents.ts in
// shape so the route + UI patterns carry over.
export const LOGO_ACCEPTED_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml"
} as const;

export type LogoExt = keyof typeof LOGO_ACCEPTED_MIME;
const LOGO_MIME_VALUES = Object.values(LOGO_ACCEPTED_MIME) as [string, ...string[]];

// 512 KB hard cap (AC-12.1) — a logo, not a document.
export const MAX_LOGO_BYTES = 512 * 1024;

export const logoMetaSchema = z.object({
  mimeType: z.enum(LOGO_MIME_VALUES, {
    errorMap: () => ({ message: "صيغة غير مدعومة — PNG أو JPEG أو WebP أو SVG فقط" })
  }),
  sizeBytes: z
    .number()
    .int()
    .positive("الملف فارغ")
    .max(MAX_LOGO_BYTES, "الحد الأقصى لحجم الشعار 512 كيلوبايت")
});

export type LogoMeta = z.infer<typeof logoMetaSchema>;

// Map a validated MIME back to its canonical extension (for the storage key).
// JPEG canonicalises to "jpg".
export function extForLogoMime(mime: string): LogoExt | null {
  const entry = (Object.entries(LOGO_ACCEPTED_MIME) as [LogoExt, string][]).find(
    ([, v]) => v === mime
  );
  return entry ? entry[0] : null;
}

// Resolve the canonical MIME for a logo upload. Browsers reliably tag images, but
// some report "" / "application/octet-stream" — fall back to the filename
// extension so a valid image the AC promises to accept isn't wrongly rejected.
const LOGO_EXT_TO_MIME: Record<string, string> = {
  png: LOGO_ACCEPTED_MIME.png,
  jpg: LOGO_ACCEPTED_MIME.jpg,
  jpeg: LOGO_ACCEPTED_MIME.jpg,
  webp: LOGO_ACCEPTED_MIME.webp,
  svg: LOGO_ACCEPTED_MIME.svg
};

export function resolveLogoMime(
  filename: string,
  declaredType: string | undefined | null
): string | null {
  if (declaredType && (LOGO_MIME_VALUES as readonly string[]).includes(declaredType)) {
    return declaredType;
  }
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ext ? LOGO_EXT_TO_MIME[ext] ?? null : null;
}
