import Link from "next/link";

// AC-4.1 — pricing page: Starter 35 JOD / Pro 70 JOD, monthly.
const PLANS = [
  {
    name: "Starter",
    nameAr: "المبتدئ",
    price: 35,
    features: ["حتى 100 وثيقة", "500 استعلام شهرياً", "مستخدم واحد"]
  },
  {
    name: "Pro",
    nameAr: "الاحترافي",
    price: 70,
    features: ["وثائق غير محدودة", "استعلامات غير محدودة", "حتى 10 مستخدمين", "دعم أولوية"]
  }
];

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-20">
      <h1 className="text-center text-3xl font-bold text-amber-500">الأسعار</h1>
      <p className="mt-3 text-center text-slate-300">
        ادفع بالدينار الأردني. ألغِ في أي وقت.
      </p>
      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className="rounded-2xl border border-slate-700 bg-slate-900/40 p-8"
          >
            <h2 className="text-xl font-semibold text-slate-100">{plan.nameAr}</h2>
            <p className="mt-4 text-3xl font-bold text-amber-500">
              {plan.price}{" "}
              <span className="text-base font-normal text-slate-400">
                <span className="bidi-term">JOD</span> / شهرياً
              </span>
            </p>
            <ul className="mt-6 space-y-2 text-slate-300">
              {plan.features.map((f) => (
                <li key={f}>• {f}</li>
              ))}
            </ul>
            <Link
              href={`/signup?plan=${plan.name.toLowerCase()}`}
              className="mt-8 block rounded-lg bg-amber-600 px-6 py-3 text-center font-medium text-white hover:bg-amber-500"
            >
              ابدأ الآن
            </Link>
          </div>
        ))}
      </div>
    </main>
  );
}
