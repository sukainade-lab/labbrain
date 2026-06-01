import { NextResponse } from "next/server";
import { loginSchema } from "@/lib/validation/auth";
import { createClient } from "@/lib/supabase/server";
import { attemptLogin } from "@/lib/auth/login";

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
  return NextResponse.json({ ok: true, next: "/dashboard" });
}
