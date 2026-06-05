"use client";

import { useState } from "react";

const field =
  "w-full rounded-control border border-line bg-card px-4 py-3 text-ink shadow-soft placeholder:text-muted focus:border-brand-amber focus:outline-none";

export function InvoiceRequestForm({ defaultPlan }: { defaultPlan?: string }) {
  const [form, setForm] = useState({
    companyName: "",
    contactName: "",
    contactEmail: "",
    plan: defaultPlan === "pro" ? "pro" : "starter",
    interval: "month",
    billingAddress: "",
    vatNumber: ""
  });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/invoice-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "تعذّر إرسال الطلب");
        return;
      }
      setSent(true);
    } catch {
      setError("تعذّر الاتصال. حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <div className="text-5xl">🧾</div>
        <h1 className="mt-4 text-2xl font-bold text-navy">استلمنا طلبك</h1>
        <p className="mt-3 leading-7 text-muted">
          سيتواصل معك فريقنا قريباً بفاتورة رسمية وتفاصيل التحويل البنكي.
        </p>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-bold text-navy">طلب فاتورة / تحويل بنكي</h1>
      <p className="mt-2 text-sm text-muted">
        للمختبرات التي تفضّل الدفع بالفاتورة الرسمية والتحويل البنكي بالدينار الأردني.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <input
          className={field}
          placeholder="اسم المختبر"
          value={form.companyName}
          onChange={(e) => set("companyName", e.target.value)}
          required
        />
        <input
          className={field}
          placeholder="اسم المسؤول"
          value={form.contactName}
          onChange={(e) => set("contactName", e.target.value)}
          required
        />
        <input
          className={field}
          type="email"
          dir="ltr"
          placeholder="البريد الإلكتروني"
          value={form.contactEmail}
          onChange={(e) => set("contactEmail", e.target.value)}
          required
        />

        <div className="grid grid-cols-2 gap-3">
          <select
            className={field}
            value={form.plan}
            onChange={(e) => set("plan", e.target.value)}
            aria-label="الباقة"
          >
            <option value="starter">المبتدئ</option>
            <option value="pro">الاحترافي</option>
          </select>
          <select
            className={field}
            value={form.interval}
            onChange={(e) => set("interval", e.target.value)}
            aria-label="دورة الفوترة"
          >
            <option value="month">شهري</option>
            <option value="year">سنوي</option>
          </select>
        </div>

        <textarea
          className={field}
          rows={3}
          placeholder="عنوان الفوترة"
          value={form.billingAddress}
          onChange={(e) => set("billingAddress", e.target.value)}
          required
        />
        <input
          className={field}
          placeholder="الرقم الضريبي (اختياري)"
          value={form.vatNumber}
          onChange={(e) => set("vatNumber", e.target.value)}
        />

        {error && <p className="rounded-control bg-danger-soft px-4 py-2 text-sm font-medium text-danger-strong" role="alert">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="min-h-[44px] w-full rounded-control bg-brand-amber px-6 py-3 font-semibold text-white shadow-soft transition-all hover:bg-brand-amber-hover hover:shadow-lift disabled:opacity-60"
        >
          {loading ? "جارٍ الإرسال…" : "إرسال الطلب"}
        </button>
      </form>
    </main>
  );
}
