"use client";

import { useState } from "react";

const field =
  "w-full rounded-control border border-line bg-card px-4 py-3 text-ink shadow-soft placeholder:text-muted focus:border-brand-amber focus:outline-none";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // Endpoint always returns 200 — never reveals whether the email is registered.
      await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      setSent(true);
    } catch {
      // Even on transport failure we show the neutral confirmation to avoid leaking state.
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <div className="text-5xl">📧</div>
        <h1 className="mt-4 text-2xl font-bold text-navy">تحقق من بريدك الإلكتروني</h1>
        <p className="mt-3 leading-7 text-muted">
          إذا كان <bdi className="bidi-term font-semibold text-brand-amber">{email}</bdi> مسجّلاً لدينا،
          فستصلك رسالة بها رابط لإعادة تعيين كلمة المرور.
        </p>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-bold text-navy">إعادة تعيين كلمة المرور</h1>
      <p className="mt-2 text-sm text-muted">
        أدخل بريدك وسنرسل لك رابطاً لإعادة التعيين.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <input
          className={field}
          type="email"
          dir="ltr"
          placeholder="البريد الإلكتروني"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-control bg-brand-amber px-6 py-3 font-semibold text-white shadow-soft transition-all hover:bg-brand-amber-hover hover:shadow-lift disabled:opacity-60"
        >
          {loading ? "جارٍ الإرسال…" : "إرسال رابط إعادة التعيين"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        <a href="/login" className="font-semibold text-brand-amber hover:underline">
          العودة لتسجيل الدخول
        </a>
      </p>
    </main>
  );
}
