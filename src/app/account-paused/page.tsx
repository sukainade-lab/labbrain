// AC-8.4 — public explainer shown when a lab's account has been paused by the
// founder. Reached only via the proxy redirect (a paused tenant's authenticated
// users can't enter the app). Static Arabic copy — no dynamic mixed-script data,
// so no <bdi> needed here.
export default function AccountPausedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-card border border-line bg-card p-8 text-center shadow-soft">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-soft text-2xl text-brand-amber-hover">
          ⏸
        </div>
        <h1 className="mt-5 text-xl font-bold text-navy">الحساب موقوف مؤقتاً</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          تم إيقاف حساب مختبرك مؤقتاً. لإعادة تفعيل الوصول، تواصل معنا وسنرجّع حسابك
          فوراً بعد ترتيب الأمر.
        </p>
        <a
          href="mailto:founder@labbrain.app"
          className="mt-6 inline-block rounded-control bg-brand-amber px-5 py-2.5 text-sm font-bold text-white shadow-soft transition-all hover:bg-brand-amber-hover hover:shadow-lift"
        >
          تواصل معنا
        </a>
      </div>
    </main>
  );
}
