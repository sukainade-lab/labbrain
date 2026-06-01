import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20 text-center">
      <h1 className="text-4xl font-bold text-amber-500">LabBrain</h1>
      <p className="mt-4 text-lg text-slate-300">
        إجابات موثّقة من وثائق مختبرك — بالعربي والإنجليزي. صفر هلوسة، استشهاد
        إجباري بالمصدر، مبني لمعايير{" "}
        <span className="bidi-term">ISO/IEC 17025</span>.
      </p>
      <div className="mt-10 flex justify-center gap-4">
        <Link
          href="/pricing"
          className="rounded-lg bg-amber-600 px-6 py-3 font-medium text-white hover:bg-amber-500"
        >
          الأسعار
        </Link>
        <Link
          href="/signup"
          className="rounded-lg border border-slate-600 px-6 py-3 font-medium text-slate-200 hover:border-amber-500"
        >
          إنشاء حساب
        </Link>
      </div>
    </main>
  );
}
