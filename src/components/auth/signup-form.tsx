"use client";

import { useState } from "react";

const field =
  "w-full rounded-lg border border-[#334155] bg-[#0F172A] px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-[#D97706] focus:outline-none";

export function SignupForm({ token }: { token?: string }) {
  const [labName, setLabName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const isInvite = Boolean(token);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          labName: isInvite ? "—" : labName,
          adminName,
          email,
          password,
          ...(token ? { inviteToken: token } : {})
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "تعذّر إنشاء الحساب");
        return;
      }
      setSent(true);
    } catch {
      setError("تعذّر الاتصال بالخادم");
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
          أرسلنا رابط التأكيد إلى <bdi className="bidi-term text-[#F59E0B]">{email}</bdi>.
          الرابط صالح لمدة 24 ساعة — اضغطه لتفعيل حسابك ومتابعة الإعداد.
        </p>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-bold text-[#F59E0B]">
        {isInvite ? "انضم إلى فريق مختبرك" : "إنشاء حساب مختبرك"}
      </h1>
      <p className="mt-2 text-sm text-slate-400">14 يوم تجريبي مجاناً — لا يلزم بطاقة</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        {!isInvite && (
          <input
            className={field}
            placeholder="اسم المختبر"
            value={labName}
            onChange={(e) => setLabName(e.target.value)}
            required
          />
        )}
        <input
          className={field}
          placeholder="اسمك الكامل"
          value={adminName}
          onChange={(e) => setAdminName(e.target.value)}
          required
        />
        <input
          className={field}
          type="email"
          dir="ltr"
          placeholder="البريد الإلكتروني للعمل"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className={field}
          type="password"
          placeholder="كلمة المرور (8 أحرف على الأقل)"
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
          {loading ? "جارٍ الإنشاء…" : isInvite ? "إنشاء الحساب والانضمام" : "إنشاء الحساب"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        لديك حساب؟{" "}
        <a href="/login" className="text-[#F59E0B] hover:underline">
          تسجيل الدخول
        </a>
      </p>
    </main>
  );
}
