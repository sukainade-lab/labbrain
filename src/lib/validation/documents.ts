import { z } from "zod";

// Accepted upload formats (AC-2.1). Keyed by extension → MIME type. Browsers and
// LlamaParse both key off MIME, so we validate the MIME and keep the extension
// for building the storage path / display name.
export const ACCEPTED_MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
} as const;

export type AcceptedExt = keyof typeof ACCEPTED_MIME;
const ACCEPTED_MIME_VALUES = Object.values(ACCEPTED_MIME) as [string, ...string[]];

// 50 MB hard cap (AC-2.1).
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const uploadMetaSchema = z.object({
  filename: z.string().trim().min(1, "اسم الملف مطلوب"),
  mimeType: z.enum(ACCEPTED_MIME_VALUES, {
    errorMap: () => ({ message: "صيغة غير مدعومة — PDF أو DOCX أو XLSX فقط" })
  }),
  sizeBytes: z
    .number()
    .int()
    .positive("الملف فارغ")
    .max(MAX_UPLOAD_BYTES, "الحد الأقصى لحجم الملف 50 ميغابايت")
});

export type UploadMeta = z.infer<typeof uploadMetaSchema>;

// Map a validated MIME back to its extension (for storage path + parser hint).
export function extForMime(mime: string): AcceptedExt | null {
  const entry = (Object.entries(ACCEPTED_MIME) as [AcceptedExt, string][]).find(
    ([, v]) => v === mime
  );
  return entry ? entry[0] : null;
}

// Resolve the canonical MIME for an upload. Browsers reliably tag PDFs but often
// report DOCX/XLSX as "" or "application/octet-stream"; without this fallback a
// valid Office file the AC promises to accept would be rejected. We trust an
// already-accepted declared type, otherwise infer from the filename extension.
const EXT_TO_MIME: Record<string, string> = {
  pdf: ACCEPTED_MIME.pdf,
  docx: ACCEPTED_MIME.docx,
  xlsx: ACCEPTED_MIME.xlsx
};

export function resolveMime(filename: string, declaredType: string | undefined | null): string | null {
  if (declaredType && (ACCEPTED_MIME_VALUES as readonly string[]).includes(declaredType)) {
    return declaredType;
  }
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ext ? EXT_TO_MIME[ext] ?? null : null;
}
