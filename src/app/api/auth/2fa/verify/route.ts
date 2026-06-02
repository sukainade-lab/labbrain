import { NextResponse } from "next/server";
import { otpVerifySchema } from "@/lib/validation/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyChallenge, verifyErrorMessage, mfaSecret } from "@/lib/auth/mfa";
import { signMfaCookie, mfaCookieOptions, MFA_COOKIE_NAME } from "@/lib/auth/mfa-cookie";

// AC-7.3 — verify an OTP and apply the per-purpose side effect:
//   login   → set the lb_mfa elevation cookie, route to /dashboard
//   enroll  → flip mfa_enabled true + stamp phone_verified_at, set cookie, /dashboard
//   disable → flip mfa_enabled false, CLEAR the cookie, /dashboard
// Wrong / expired / exhausted / consumed → 401 with a localized message, no elevation.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = otpVerifySchema.safeParse(body);
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
  const decision = await verifyChallenge(admin, {
    userId: user.id,
    purpose: parsed.data.purpose,
    code: parsed.data.code
  });

  if (decision !== "ok") {
    return NextResponse.json({ error: verifyErrorMessage(decision) }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, next: "/dashboard" });

  if (parsed.data.purpose === "disable") {
    await admin
      .from("users")
      .update({ mfa_enabled: false, phone_verified_at: null })
      .eq("id", user.id);
    res.cookies.set(MFA_COOKIE_NAME, "", { ...mfaCookieOptions(), maxAge: 0 });
    return res;
  }

  if (parsed.data.purpose === "enroll") {
    await admin
      .from("users")
      .update({ mfa_enabled: true, phone_verified_at: new Date().toISOString() })
      .eq("id", user.id);
  }

  // login + enroll both elevate the session.
  res.cookies.set(MFA_COOKIE_NAME, signMfaCookie(user.id, mfaSecret()), mfaCookieOptions());
  return res;
}
