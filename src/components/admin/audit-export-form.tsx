"use client";

import { useState } from "react";

// AC-9.5 — owner/admin export trigger: optional from/to date pickers + a download
// button that hits GET /api/audit/export and saves the returned PDF. Fetches as a
// blob so a 400 (bad range) / 403 surfaces inline rather than navigating away.
// RTL, ≥44px tap targets (L7).

const field =
  "min-h-[44px] rounded-control border border-line bg-card px-4 py-3 text-ink shadow-soft focus:border-brand-amber focus:outline-none";

function filenameFromDisposition(res: Response): string | null {
  const disp = res.headers.get("content-disposition");
  const m = disp?.match(/filename="([^"]+)"/);
  return m?.[1] ?? null;
}

export function AuditExportForm() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (from && to && from > to) {
      setError("نطاق غير صالح — تاريخ البداية بعد تاريخ النهاية");
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString();
      const res = await fetch(`/api/audit/export${qs ? `?${qs}` : ""}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "تعذّر إنشاء ملف التصدير");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFromDisposition(res) ?? "labbrain-audit.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-sm text-muted">
          من تاريخ
          <input
            className={field}
            type="date"
            dir="ltr"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="من تاريخ"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          إلى تاريخ
          <input
            className={field}
            type="date"
            dir="ltr"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="إلى تاريخ"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="min-h-[44px] whitespace-nowrap rounded-control bg-brand-amber px-6 py-3 font-semibold text-white shadow-soft transition-all hover:bg-brand-amber-hover hover:shadow-lift disabled:opacity-60"
        >
          {loading ? "جارٍ التصدير…" : "تصدير سجل الأسئلة (PDF)"}
        </button>
      </div>
      <p className="text-xs text-muted">
        اترك الحقول فارغة لتصدير كامل السجل.
      </p>

      {error && (
        <p className="rounded-control bg-danger-soft px-4 py-2 text-sm font-medium text-danger-strong" role="alert">
          <span aria-hidden="true">⚠️ </span>
          {error}
        </p>
      )}
    </form>
  );
}
