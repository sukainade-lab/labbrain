// AC-1.1 — login shell. Auth wiring lands in S1 implementation.
export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <h1 className="text-2xl font-bold text-amber-500">تسجيل الدخول</h1>
      <form className="mt-8 space-y-4">
        <input
          type="email"
          placeholder="البريد الإلكتروني"
          className="w-full rounded-lg border border-slate-600 bg-slate-900/40 px-4 py-3 text-slate-100"
        />
        <input
          type="password"
          placeholder="كلمة المرور"
          className="w-full rounded-lg border border-slate-600 bg-slate-900/40 px-4 py-3 text-slate-100"
        />
        <button
          type="submit"
          className="w-full rounded-lg bg-amber-600 px-6 py-3 font-medium text-white hover:bg-amber-500"
        >
          دخول
        </button>
      </form>
    </main>
  );
}
