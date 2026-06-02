"use client";

import { useState } from "react";

const field =
  "w-full rounded-lg border border-[#334155] bg-[#0F172A] px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-[#D97706] focus:outline-none";

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
        <h1 className="mt-4 text-2xl font-bold text-[#F59E0B]">تحقق من بريدك الإلكتروني</h1>
        <p className="mt-3 leading-7 text-slate-400">
          إذا كان <bdi className="bidi-term text-[#F59E0B]">{email}</bdi> مسجّلاً لدينا،
          فستصلك رسالة بها رابط لإعادة تعيين كلمة المرور.
        </p>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-bold text-[#F59E0B]">إعادة تعيين كلمة المرور</h1>
      <p className="mt-2 text-sm text-slate-400">
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
          className="w-full rounded-lg bg-brand-amber px-6 py-3 font-medium text-white hover:bg-brand-amber-hover disabled:opacity-60"
        >
          {loading ? "جارٍ الإرسال…" : "إرسال رابط إعادة التعيين"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        <a href="/login" className="text-[#F59E0B] hover:underline">
          العودة لتسجيل الدخول
        </a>
      </p>
    </main>
  );
}
