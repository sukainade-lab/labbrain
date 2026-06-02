import { NextResponse } from "next/server";
import { enrollSchema } from "@/lib/validation/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeJordanPhone, toUnifonicRecipient } from "@/lib/auth/phone";
import { issueChallenge } from "@/lib/auth/mfa";

// AC-7.1 — start phone enrollment. Saves the normalized number on the user (still
// mfa_enabled=false) and SMSes an enroll OTP. mfa_enabled only flips true after the
// matching /verify round-trip — never here, on save alone.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = enrollSchema.safeParse(body);
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

  const e164 = normalizeJordanPhone(parsed.data.phone);
  if (!e164) return NextResponse.json({ error: "رقم هاتف أردني غير صالح." }, { status: 400 });

  const admin = createAdminClient();
  await admin
    .from("users")
    .update({ phone: e164, phone_verified_at: null, mfa_enabled: false })
    .eq("id", user.id);

  const result = await issueChallenge(admin, {
    userId: user.id,
    recipient: toUnifonicRecipient(e164),
    purpose: "enroll"
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: "لقد طلبت رموزاً كثيرة. حاول لاحقاً.", retryAfterMs: result.retryAfterMs },
      { status: 429 }
    );
  }

  return NextResponse.json({ ok: true });
}
