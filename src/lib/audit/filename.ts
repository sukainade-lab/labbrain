// Story 9 — download filename (AC-9.5): labbrain-audit-<lab-slug>-<YYYYMMDD>.pdf.
// Lab names are usually Arabic, which slugifies to empty; in that case we fall
// back to a short slice of the tenant id so the filename is always meaningful
// and ASCII-safe for Content-Disposition.

const AMMAN_TZ = "Asia/Amman";

export function labSlug(labName: string, tenantId: string): string {
  const slug = labName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `lab-${tenantId.slice(0, 8)}`;
}

// Compact YYYYMMDD stamp in Amman local time (matches the report's date basis).
export function stampYmd(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: AMMAN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

export function buildAuditFilename(
  labName: string,
  tenantId: string,
  date: Date = new Date()
): string {
  return `labbrain-audit-${labSlug(labName, tenantId)}-${stampYmd(date)}.pdf`;
}
