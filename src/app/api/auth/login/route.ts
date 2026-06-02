import { NextResponse } from "next/server";
import { loginSchema } from "@/lib/validation/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { attemptLogin } from "@/lib/auth/login";
import { getUserMfa, issueChallenge } from "@/lib/auth/mfa";
import { toUnifonicRecipient } from "@/lib/auth/phone";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const result = await attemptLogin(supabase, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401 });

  // AC-7.4 — a 2FA-enabled user is past the password factor but NOT yet elevated:
  // issue a login OTP and route to the verify step instead of the dashboard. Without
  // the lb_mfa cookie the middleware will keep them out of the (app) group anyway,
  // so the verify screen is the only place they can go next. Best-effort SMS: if the
  // provider hiccups, they can resend from the verify screen.
  if (result.userId) {
    const admin = createAdminClient();
    const mfa = await getUserMfa(admin, result.userId);
    if (mfa?.mfa_enabled && mfa.phone) {
      try {
        await issueChallenge(admin, {
          userId: result.userId,
          recipient: toUnifonicRecipient(mfa.phone),
          purpose: "login"
        });
      } catch {
        // Surface the verify screen regardless; the user can request a fresh code.
      }
      return NextResponse.json({ ok: true, mfa: true, next: "/login/verify" });
    }
  }

  return NextResponse.json({ ok: true, next: "/dashboard" });
}
