import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// AC-1.1 / AC-1.2 — post-verification landing. After the user clicks the email
// confirmation link, /auth/confirm exchanges the code for a session and redirects
// here. We greet them and route into plan selection (S4) then the product.
export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto max-w-lg px-6 py-20 text-center">
      <div className="text-5xl">✅</div>
      <h1 className="mt-4 text-2xl font-bold text-[#F59E0B]">تم تأكيد حسابك</h1>
      <p className="mt-3 leading-7 text-slate-400">
        {user?.email ? (
          <>
            أهلاً <bdi className="bidi-term text-[#F59E0B]">{user.email}</bdi> — حسابك جاهز.
          </>
        ) : (
          "حسابك جاهز."
        )}{" "}
        اختر خطة مختبرك لتفعيل رفع الوثائق والأسئلة.
      </p>

      <div className="mt-8 flex flex-col gap-3">
        <Link
          href="/pricing"
          className="w-full rounded-lg bg-[#D97706] px-6 py-3 font-medium text-white hover:bg-[#F59E0B]"
        >
          اختيار الخطة
        </Link>
        <Link
          href="/dashboard"
          className="w-full rounded-lg border border-[#334155] px-6 py-3 font-medium text-slate-300 hover:border-[#D97706] hover:text-[#F59E0B]"
        >
          الذهاب للوحة التحكم
        </Link>
      </div>
    </main>
  );
}
