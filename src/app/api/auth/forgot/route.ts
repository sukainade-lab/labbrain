import { NextResponse } from "next/server";
import { forgotSchema } from "@/lib/validation/auth";
import { createClient } from "@/lib/supabase/server";
import { requestPasswordReset } from "@/lib/auth/login";

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
  await requestPasswordReset(supabase, parsed.data.email, `${appUrl}/auth/confirm?next=/dashboard`);
  // Always 200 — never reveal whether the email is registered.
  return NextResponse.json({ ok: true });
}
