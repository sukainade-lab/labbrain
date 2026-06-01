import { NextResponse } from "next/server";
import { forgotSchema } from "@/lib/validation/auth";
import { createClient } from "@/lib/supabase/server";
import { ONBOARDING_PATH } from "@/lib/auth/provision";

// Resend the signup confirmation email (AC-1.2 — matches onboarding-flow step 2's
// "أعد الإرسال" affordance). Reuses the email-only schema. Always returns 200 so
// it can't be used to probe which addresses are registered/unconfirmed.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = forgotSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" },
      { status: 400 }
    );
  }

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const supabase = await createClient();
  await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: `${appUrl}/auth/confirm?next=${encodeURIComponent(ONBOARDING_PATH)}` }
  });

  return NextResponse.json({ ok: true });
}
