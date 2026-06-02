import { NextResponse } from "next/server";
import { otpSendSchema } from "@/lib/validation/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toUnifonicRecipient } from "@/lib/auth/phone";
import { getUserMfa, issueChallenge } from "@/lib/auth/mfa";

// AC-7.2 / AC-7.5 — (re)send an OTP for a purpose to the user's registered number.
// Honors the resend cooldown + per-window send budget (429 on either).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = otpSendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول أولاً." }, { status: 401 });

  const admin = createAdminClient();
  const mfa = await getUserMfa(admin, user.id);
  if (!mfa?.phone) {
    return NextResponse.json({ error: "لا يوجد رقم هاتف مسجّل." }, { status: 400 });
  }

  const result = await issueChallenge(admin, {
    userId: user.id,
    recipient: toUnifonicRecipient(mfa.phone),
    purpose: parsed.data.purpose
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          result.reason === "cooldown"
            ? "الرجاء الانتظار قبل طلب رمز جديد."
            : "لقد طلبت رموزاً كثيرة. حاول لاحقاً.",
        retryAfterMs: result.retryAfterMs
      },
      { status: 429 }
    );
  }

  return NextResponse.json({ ok: true });
}
