import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-canvas">
      {/* Navy-gradient hero with radial amber glows (accent-only bright amber).
          Headline is white on navy (AA). RTL-first by inheritance from <html dir>. */}
      <section className="relative overflow-hidden bg-gradient-to-bl from-navy via-navy2 to-navy3 px-6 py-24 text-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 start-0 h-96 w-96 rounded-full bg-amber-bright/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 end-0 h-96 w-96 rounded-full bg-amber-bright/10 blur-3xl"
        />
        <div className="relative mx-auto max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm font-medium text-amber-bright">
            <span aria-hidden="true">●</span>
            ذكاء وثائقي للمختبرات المعتمدة
          </span>
          <h1 className="mt-6 text-5xl font-bold tracking-tight text-white">LabBrain</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-slate-200">
            إجابات موثّقة من وثائق مختبرك — بالعربي والإنجليزي. صفر هلوسة، استشهاد
            إجباري بالمصدر، مبني لمعايير{" "}
            <span className="bidi-term">ISO/IEC 17025</span>.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link
              href="/signup"
              className="rounded-control bg-brand-amber px-7 py-3 font-semibold text-white shadow-lift transition-all duration-200 hover:bg-brand-amber-hover hover:-translate-y-0.5"
            >
              إنشاء حساب
            </Link>
            <Link
              href="/pricing"
              className="rounded-control border border-white/25 px-7 py-3 font-semibold text-white transition-colors hover:border-amber-bright hover:text-amber-bright"
            >
              الأسعار
            </Link>
          </div>
        </div>
      </section>

      {/* Three value cards — the reference's accent-stripe card system on light. */}
      <section className="mx-auto -mt-12 max-w-5xl px-6 pb-24">
        <div className="grid gap-5 sm:grid-cols-3">
          {[
            {
              accent: "bg-amber-bright",
              title: "صفر هلوسة",
              body: "كل إجابة مبنيّة على مقاطع مسترجَعة من وثائقك أنت — لا معرفة عامة، أبداً."
            },
            {
              accent: "bg-success",
              title: "استشهاد إجباري",
              body: "كل إجابة تحمل اسم الوثيقة ورقم الصفحة، جاهزة لجلسة الاعتماد."
            },
            {
              accent: "bg-info",
              title: "عربي وإنجليزي",
              body: "RTL أصيل، مصطلحات تقنية إنجليزية معزولة، خطّ IBM Plex Arabic."
            }
          ].map((c) => (
            <div
              key={c.title}
              className="relative overflow-hidden rounded-card border border-line bg-card p-6 shadow-soft transition-all duration-200 hover:-translate-y-[3px] hover:shadow-lift"
            >
              <span
                aria-hidden="true"
                className={`absolute inset-y-0 start-0 w-1.5 ${c.accent}`}
              />
              <h2 className="text-lg font-bold text-navy">{c.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{c.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
