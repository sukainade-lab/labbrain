"use client";

import { useState } from "react";

// AC-7.1 / AC-7.6 — account-settings 2FA section. Two flows, one component:
//   • enroll  — phone entry → POST /enroll (issues OTP) → code entry → POST /verify
//               {purpose:"enroll"} which flips users.mfa_enabled on.
//   • disable — POST /disable (issues OTP) → code entry → POST /verify
//               {purpose:"disable"} which flips it back off.
// RTL layout; the phone number and the 6-digit code are LTR with <bdi> isolation so
// they never reorder inside the Arabic flow (L5). aria-live announces sent/error
// states. Targets are ≥44px for the 375px WhatsApp-demo viewport.

const field =
  "w-full rounded-control border border-line bg-card px-4 py-3 min-h-[44px] text-ink shadow-soft placeholder:text-muted focus:border-brand-amber focus:outline-none";
const codeField = `${field} text-center text-2xl tracking-[0.5em] placeholder:tracking-normal`;
const primaryBtn =
  "w-full rounded-control bg-brand-amber px-6 py-3 min-h-[44px] font-semibold text-white shadow-soft transition-all hover:bg-brand-amber-hover hover:shadow-lift disabled:opacity-60";

type Stage = "idle" | "code";
type Flow = "enroll" | "disable";

export function MfaSettings({
  initialEnabled,
  initialPhone
}: {
  initialEnabled: boolean;
  initialPhone: string | null;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [flow, setFlow] = useState<Flow>("enroll");
  const [stage, setStage] = useState<Stage>("idle");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function reset() {
    setStage("idle");
    setCode("");
    setError(null);
    setInfo(null);
  }

  async function startEnroll(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "تعذّر إرسال الرمز");
        return;
      }
      setFlow("enroll");
      setStage("code");
      setInfo("تم إرسال رمز التحقق عبر رسالة نصية.");
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  async function startDisable() {
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/disable", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "تعذّر إرسال الرمز");
        return;
      }
      setFlow("disable");
      setStage("code");
      setInfo("تم إرسال رمز التحقق عبر رسالة نصية.");
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  async function confirmCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, purpose: flow })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "تعذّر التحقق من الرمز");
        return;
      }
      setEnabled(flow === "enroll");
      reset();
      setInfo(
        flow === "enroll"
          ? "تم تفعيل التحقق بخطوتين."
          : "تم إيقاف التحقق بخطوتين."
      );
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-card border border-line bg-card p-6 shadow-soft">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-navy">التحقق بخطوتين (2FA)</h2>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            enabled ? "bg-success-soft text-success-strong" : "bg-canvas text-muted"
          }`}
        >
          {enabled ? "مُفعّل" : "غير مُفعّل"}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        أضف طبقة حماية إضافية: رمز يُرسل عبر رسالة نصية إلى هاتفك عند تسجيل الدخول.
      </p>

      <div aria-live="polite" className="mt-4 min-h-[1.25rem]">
        {error && (
          <p
            className="rounded-control bg-danger-soft px-4 py-2 text-sm font-medium text-danger-strong"
            role="alert"
          >
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

      {/* Code-entry stage is shared by both flows. */}
      {stage === "code" ? (
        <form onSubmit={confirmCode} className="mt-4 space-y-4">
          <input
            className={codeField}
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
          <div className="flex gap-3">
            <button type="submit" disabled={loading || code.length !== 6} className={primaryBtn}>
              {loading
                ? "جارٍ التحقق…"
                : flow === "enroll"
                  ? "تأكيد التفعيل"
                  : "تأكيد الإيقاف"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={loading}
              className="min-h-[44px] rounded-control border border-line px-5 text-sm text-muted transition-colors hover:bg-canvas hover:text-navy disabled:opacity-60"
            >
              إلغاء
            </button>
          </div>
        </form>
      ) : enabled ? (
        // Enabled → offer disable (which sends a confirming OTP first).
        <div className="mt-4">
          {phone && (
            <p className="text-sm text-muted">
              الهاتف المُسجّل: <bdi dir="ltr">{phone}</bdi>
            </p>
          )}
          <button
            type="button"
            onClick={startDisable}
            disabled={loading}
            className="mt-4 min-h-[44px] rounded-control border border-danger-strong px-5 text-sm font-medium text-danger-strong transition-colors hover:bg-danger-strong hover:text-white disabled:opacity-60"
          >
            {loading ? "جارٍ الإرسال…" : "إيقاف التحقق بخطوتين"}
          </button>
        </div>
      ) : (
        // Disabled → collect a phone number and send an enrollment OTP.
        <form onSubmit={startEnroll} className="mt-4 space-y-4">
          <label className="block">
            <span className="text-sm text-ink">رقم الهاتف (أردني)</span>
            <input
              className={`${field} mt-1`}
              type="tel"
              inputMode="tel"
              dir="ltr"
              placeholder="07XXXXXXXX"
              aria-label="رقم الهاتف"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={loading || !phone.trim()} className={primaryBtn}>
            {loading ? "جارٍ الإرسال…" : "إرسال رمز التفعيل"}
          </button>
        </form>
      )}
    </section>
  );
}
