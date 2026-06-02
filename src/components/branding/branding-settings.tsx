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
  "rounded-lg bg-brand-amber px-6 py-3 min-h-[44px] font-medium text-white hover:bg-brand-amber-hover disabled:opacity-60";
const removeBtn =
  "min-h-[44px] rounded-lg border border-red-800 px-5 text-sm font-medium text-red-200 hover:bg-red-900/30 disabled:opacity-60";

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
    <section className="rounded-xl border border-[#334155] bg-[#1B2A3D] p-6">
      <h2 className="text-lg font-bold text-slate-100">شعار المختبر</h2>
      <p className="mt-1 text-sm text-slate-400">
        يظهر الشعار في ترويسة التطبيق بجانب اسم المختبر. الصيغ المدعومة: PNG أو JPEG
        أو WebP أو SVG، بحد أقصى 512 كيلوبايت.
      </p>

      <div aria-live="polite" className="mt-4 min-h-[1.25rem]">
        {error && (
          <p className="rounded-lg bg-red-950/50 px-4 py-2 text-sm text-red-300" role="alert">
            <span aria-hidden="true">⚠️ </span>
            {error}
          </p>
        )}
        {info && (
          <p className="rounded-lg bg-emerald-950/40 px-4 py-2 text-sm text-emerald-300">{info}</p>
        )}
      </div>

      {/* Current logo preview (AC-12.6: meaningful Arabic alt + explicit dims). */}
      <div className="mt-4 flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-slate-900/60">
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
            <span className="text-xs text-slate-500">لا يوجد</span>
          )}
        </div>
        <p className="text-sm text-slate-400">
          {logoUrl ? (
            <>الشعار الحالي لمختبر <bdi dir="auto">{labName}</bdi></>
          ) : (
            <>لا يوجد شعار — تُعرض الترويسة باسم <bdi dir="auto">{labName}</bdi></>
          )}
        </p>
      </div>

      <form onSubmit={upload} className="mt-5 space-y-4">
        <label className="block">
          <span className="text-sm text-slate-300">اختر ملف الشعار</span>
          <input
            className="mt-1 block w-full min-h-[44px] text-sm text-slate-300 file:mr-4 file:min-h-[44px] file:cursor-pointer file:rounded-lg file:border-0 file:bg-slate-700 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-100 hover:file:bg-slate-600"
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
