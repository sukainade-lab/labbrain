// AC-8.4 — public explainer shown when a lab's account has been paused by the
// founder. Reached only via the proxy redirect (a paused tenant's authenticated
// users can't enter the app). Static Arabic copy — no dynamic mixed-script data,
// so no <bdi> needed here.
export default function AccountPausedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0F172A] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[#334155] bg-[#1B2A3D] p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#D97706]/15 text-2xl text-[#F59E0B]">
          ⏸
        </div>
        <h1 className="mt-5 text-xl font-bold text-slate-100">الحساب موقوف مؤقتاً</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          تم إيقاف حساب مختبرك مؤقتاً. لإعادة تفعيل الوصول، تواصل معنا وسنرجّع حسابك
          فوراً بعد ترتيب الأمر.
        </p>
        <a
          href="mailto:founder@labbrain.app"
          className="mt-6 inline-block rounded-lg bg-[#D97706] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#B45309]"
        >
          تواصل معنا
        </a>
      </div>
    </main>
  );
}
