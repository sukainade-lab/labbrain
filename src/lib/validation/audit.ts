import { z } from "zod";

// Story 9 — audit-export date range (AC-9.3). The export accepts an optional
// inclusive [from, to] window (ISO YYYY-MM-DD). Either bound may be omitted:
// both omitted → full history. Reversed or malformed dates are a 400.

// A bound is either a calendar date string (YYYY-MM-DD) or null (open end).
export interface AuditRange {
  from: string | null;
  to: string | null;
}

export type ParseAuditRangeResult =
  | { ok: true; range: AuditRange }
  | { ok: false; message: string };

// Strict YYYY-MM-DD that must also be a real calendar date — rejects 2026-02-30,
// 2026-13-01, etc. (a bare regex would let impossible dates through, and a bare
// `new Date()` would silently roll them over).
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

const isoDate = z
  .string()
  .trim()
  .refine(isValidIsoDate, { message: "التاريخ يجب أن يكون بصيغة YYYY-MM-DD" });

// Treat empty/whitespace/undefined as an omitted bound (null). The admin UI may
// post empty date inputs; those mean "no bound", not "invalid".
const optionalBound = z
  .union([z.string(), z.undefined(), z.null()])
  .transform((v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null))
  .pipe(isoDate.nullable());

export const auditRangeSchema = z.object({
  from: optionalBound,
  to: optionalBound
});

export type AuditRangeInput = {
  from?: string | null;
  to?: string | null;
};

// Parse + validate raw query params into a normalized range. Never throws —
// returns a discriminated result so the route can map !ok → 400.
export function parseAuditRange(input: AuditRangeInput): ParseAuditRangeResult {
  const parsed = auditRangeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "نطاق تاريخ غير صالح"
    };
  }
  const { from, to } = parsed.data;
  // Inclusive range: from must not be after to.
  if (from && to && from > to) {
    return {
      ok: false,
      message: "نطاق غير صالح — تاريخ البداية بعد تاريخ النهاية"
    };
  }
  return { ok: true, range: { from, to } };
}

// Human-readable header label for the PDF (AC-9.3 / AC-9.4). Bilingual, with the
// ISO dates kept verbatim (bidi-isolated at render time, L5).
export function rangeLabel(range: AuditRange): string {
  const { from, to } = range;
  if (!from && !to) return "كامل السجل / full history";
  if (from && to) return `${from} — ${to}`;
  if (from) return `منذ ${from} / since ${from}`;
  return `حتى ${to} / until ${to}`;
}
