import { NextResponse } from "next/server";
import { signupSchema } from "@/lib/validation/auth";
import { provisionSignup, SignupError } from "@/lib/auth/provision";
import { parseResume, onboardingNext } from "@/lib/payment/resume";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" },
      { status: 400 }
    );
  }

  // Carried plan choice (logged-out → /signup → here). Validated by allow-list;
  // anything off-list becomes null and the flow falls back to plain onboarding.
  const resume = parseResume({
    plan: (body as { plan?: string })?.plan,
    interval: (body as { interval?: string })?.interval
  });

  try {
    const result = await provisionSignup(parsed.data, resume);
    return NextResponse.json(
      { ok: true, tenantId: result.tenantId, next: onboardingNext(resume) },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof SignupError) {
      const status = err.code === "seat_limit" ? 402 : err.code === "duplicate" ? 409 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    return NextResponse.json({ error: "تعذّر إنشاء الحساب" }, { status: 500 });
  }
}
