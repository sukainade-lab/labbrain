"use client";

import { useState } from "react";

const field =
  "w-full rounded-lg border border-[#334155] bg-[#0F172A] px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-[#D97706] focus:outline-none";

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
      <h1 className="text-2xl font-bold text-[#F59E0B]">تسجيل الدخول</h1>
      <p className="mt-2 text-sm text-slate-400">أهلاً بعودتك إلى مختبرك</p>

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
          <p className="rounded-lg bg-red-950/50 px-4 py-2 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-[#D97706] px-6 py-3 font-medium text-white hover:bg-[#F59E0B] disabled:opacity-60"
        >
          {loading ? "جارٍ الدخول…" : "دخول"}
        </button>
      </form>

      <div className="mt-6 flex items-center justify-between text-sm">
        <a href="/forgot-password" className="text-slate-500 hover:text-[#F59E0B]">
          نسيت كلمة المرور؟
        </a>
        <span className="text-slate-500">
          ليس لديك حساب؟{" "}
          <a href="/signup" className="text-[#F59E0B] hover:underline">
            إنشاء حساب
          </a>
        </span>
      </div>
    </main>
  );
}
