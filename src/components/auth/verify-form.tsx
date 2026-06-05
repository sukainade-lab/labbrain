"use client";

import { useState } from "react";

// AC-7.3 / AC-7.6 — login-step OTP entry. RTL layout; the 6-digit code is LTR with
// <bdi> isolation so it never reorders inside the Arabic flow. Resend honors the
// server cooldown (429). Sent/error states are announced via aria-live. Targets are
// ≥44px for the 375px WhatsApp-demo viewport.
const field =
  "w-full rounded-control border border-line bg-card px-4 py-3 min-h-[44px] text-center text-2xl tracking-[0.5em] text-ink shadow-soft placeholder:tracking-normal placeholder:text-muted focus:border-brand-amber focus:outline-none";

export function VerifyForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, purpose: "login" })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "تعذّر التحقق من الرمز");
        return;
      }
      window.location.href = data.next ?? "/dashboard";
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    setError(null);
    setInfo(null);
    setResending(true);
    try {
      const res = await fetch("/api/auth/2fa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "login" })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "تعذّر إرسال الرمز");
        return;
      }
      setInfo("تم إرسال رمز جديد عبر رسالة نصية.");
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-bold text-navy">التحقق بخطوتين</h1>
      <p className="mt-2 text-sm text-muted">
        أدخل الرمز المكوّن من <bdi>6</bdi> أرقام الذي أرسلناه إلى هاتفك عبر رسالة نصية.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <input
          className={field}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          dir="ltr"
          maxLength={6}
          placeholder="------"
          aria-label="رمز التحقق"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          required
        />

        <div aria-live="polite" className="min-h-[1.25rem]">
          {error && (
            <p className="rounded-control bg-danger-soft px-4 py-2 text-sm font-medium text-danger-strong" role="alert">
              <span aria-hidden="true">⚠️ </span>
              {error}
            </p>
          )}
          {info && (
            <p className="rounded-control bg-success-soft px-4 py-2 text-sm font-medium text-success-strong">
              {info}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || code.length !== 6}
          className="w-full rounded-control bg-brand-amber px-6 py-3 min-h-[44px] font-semibold text-white shadow-soft transition-all hover:bg-brand-amber-hover hover:shadow-lift disabled:opacity-60"
        >
          {loading ? "جارٍ التحقق…" : "تحقّق"}
        </button>
      </form>

      <button
        type="button"
        onClick={onResend}
        disabled={resending}
        className="mt-6 min-h-[44px] text-sm text-muted transition-colors hover:text-brand-amber disabled:opacity-60"
      >
        {resending ? "جارٍ الإرسال…" : "لم يصلك الرمز؟ إعادة الإرسال"}
      </button>
    </main>
  );
}
