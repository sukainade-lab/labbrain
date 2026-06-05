"use client";

import { useState } from "react";

const field =
  "w-full rounded-control border border-line bg-card px-4 py-3 text-ink shadow-soft placeholder:text-muted focus:border-brand-amber focus:outline-none";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "تعذّر تسجيل الدخول");
        return;
      }
      window.location.href = data.next ?? "/dashboard";
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-bold text-navy">تسجيل الدخول</h1>
      <p className="mt-2 text-sm text-muted">أهلاً بعودتك إلى مختبرك</p>

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
        <input
          className={field}
          type="password"
          placeholder="كلمة المرور"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && (
          <p className="rounded-control bg-danger-soft px-4 py-2 text-sm font-medium text-danger-strong" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-control bg-brand-amber px-6 py-3 font-semibold text-white shadow-soft transition-all hover:bg-brand-amber-hover hover:shadow-lift disabled:opacity-60"
        >
          {loading ? "جارٍ الدخول…" : "دخول"}
        </button>
      </form>

      <div className="mt-6 flex items-center justify-between text-sm">
        <a href="/forgot-password" className="text-muted hover:text-brand-amber">
          نسيت كلمة المرور؟
        </a>
        <span className="text-muted">
          ليس لديك حساب؟{" "}
          <a href="/signup" className="font-semibold text-brand-amber hover:underline">
            إنشاء حساب
          </a>
        </span>
      </div>
    </main>
  );
}
