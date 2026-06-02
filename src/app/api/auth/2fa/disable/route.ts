import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toUnifonicRecipient } from "@/lib/auth/phone";
import { getUserMfa, issueChallenge } from "@/lib/auth/mfa";

// AC-7.6 — begin disabling 2FA. Sends a fresh disable-purpose OTP to the registered
// number; the matching /verify (purpose=disable) actually flips mfa_enabled off.
// Requiring a fresh OTP means a walk-up attacker on an elevated session still can't
// silently turn the second factor off.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول أولاً." }, { status: 401 });

  const admin = createAdminClient();
  const mfa = await getUserMfa(admin, user.id);
  if (!mfa?.mfa_enabled || !mfa.phone) {
    return NextResponse.json({ error: "المصادقة الثنائية غير مفعّلة." }, { status: 400 });
  }

  const result = await issueChallenge(admin, {
    userId: user.id,
    recipient: toUnifonicRecipient(mfa.phone),
    purpose: "disable"
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: "الرجاء الانتظار قبل طلب رمز جديد.", retryAfterMs: result.retryAfterMs },
      { status: 429 }
    );
  }

  return NextResponse.json({ ok: true });
}
