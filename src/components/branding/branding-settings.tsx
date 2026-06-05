"use client";

import { useState } from "react";

// AC-12.1 / AC-12.5 / AC-12.7 — Branding section of /settings. Admin-only in
// practice (the API returns 403 for members; this section is only rendered for
// admins). Upload a lab logo (PNG/JPEG/WebP/SVG, ≤512 KB) → POST /api/branding
// (multipart); remove it → DELETE /api/branding. RTL layout; the lab name is
// <bdi>-isolated so a Latin name never reorders inside the Arabic flow (L5).
// Targets are ≥44px for the 375px WhatsApp-demo viewport (AC-12.7). aria-live
// announces success/error.

const ACCEPT = ".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml";
const MAX_BYTES = 512 * 1024;

const primaryBtn =
  "rounded-control bg-brand-amber px-6 py-3 min-h-[44px] font-semibold text-white shadow-soft transition-all hover:bg-brand-amber-hover hover:shadow-lift disabled:opacity-60";
const removeBtn =
  "min-h-[44px] rounded-control border border-danger-strong px-5 text-sm font-medium text-danger-strong transition-colors hover:bg-danger-strong hover:text-white disabled:opacity-60";

export function BrandingSettings({
  initialLogoUrl,
  labName
}: {
  initialLogoUrl: string | null;
  labName: string;
}) {
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setInfo(null);
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > MAX_BYTES) {
      setError("الحد الأقصى لحجم الشعار 512 كيلوبايت");
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/branding", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "تعذّرت معالجة الشعار");
        return;
      }
      // Bust the browser cache so the new logo shows immediately (same key reused).
      setLogoUrl(data.url ? `${data.url}?t=${Date.now()}` : null);
      setFile(null);
      setInfo("تم تحديث الشعار.");
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  async function remove() {
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch("/api/branding", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "تعذّر حذف الشعار");
        return;
      }
      setLogoUrl(null);
      setFile(null);
      setInfo("تم حذف الشعار.");
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-card border border-line bg-card p-6 shadow-soft">
      <h2 className="text-lg font-bold text-navy">شعار المختبر</h2>
      <p className="mt-1 text-sm text-muted">
        يظهر الشعار في ترويسة التطبيق بجانب اسم المختبر. الصيغ المدعومة: PNG أو JPEG
        أو WebP أو SVG، بحد أقصى 512 كيلوبايت.
      </p>

      <div aria-live="polite" className="mt-4 min-h-[1.25rem]">
        {error && (
          <p className="rounded-control bg-danger-soft px-4 py-2 text-sm font-medium text-danger-strong" role="alert">
            <span aria-hidden="true">⚠️ </span>
            {error}
          </p>
        )}
        {info && (
          <p className="rounded-control bg-success-soft px-4 py-2 text-sm font-medium text-success-strong">{info}</p>
        )}
      </div>

      {/* Current logo preview (AC-12.6: meaningful Arabic alt + explicit dims). */}
      <div className="mt-4 flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-control border border-line bg-canvas">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={`شعار ${labName}`}
              width={64}
              height={64}
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="text-xs text-muted">لا يوجد</span>
          )}
        </div>
        <p className="text-sm text-muted">
          {logoUrl ? (
            <>الشعار الحالي لمختبر <bdi dir="auto">{labName}</bdi></>
          ) : (
            <>لا يوجد شعار — تُعرض الترويسة باسم <bdi dir="auto">{labName}</bdi></>
          )}
        </p>
      </div>

      <form onSubmit={upload} className="mt-5 space-y-4">
        <label className="block">
          <span className="text-sm text-ink">اختر ملف الشعار</span>
          <input
            className="mt-1 block w-full min-h-[44px] text-sm text-muted file:mr-4 file:min-h-[44px] file:cursor-pointer file:rounded-control file:border-0 file:bg-canvas file:px-4 file:py-2 file:text-sm file:font-medium file:text-navy hover:file:bg-line"
            type="file"
            accept={ACCEPT}
            aria-label="اختر ملف الشعار"
            onChange={pick}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={loading || !file} className={primaryBtn}>
            {loading ? "جارٍ الرفع…" : "رفع الشعار"}
          </button>
          {logoUrl && (
            <button type="button" onClick={remove} disabled={loading} className={removeBtn}>
              {loading ? "جارٍ الحذف…" : "حذف الشعار"}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
