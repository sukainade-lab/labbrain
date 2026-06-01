import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createCheckoutSession } from "@/lib/payment/stripe/checkout";
import { resolvePriceId } from "@/lib/payment/stripe/prices";

// AC-4.2 — start a Stripe Checkout (mode: subscription) for the signed-in
// tenant. Auth is required; the marketing CTA routes unauthenticated visitors
// to /signup?plan= first, and this handler returns 401 if they reach it anyway.
const checkoutSchema = z.object({
  plan: z.enum(["starter", "pro"]),
  interval: z.enum(["month", "year"]).default("month")
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" },
      { status: 400 }
    );
  }

  const { data: me } = await supabase
    .from("users")
    .select("tenant_id, email")
    .eq("id", user.id)
    .single();
  if (!me) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  // Reuse this tenant's Stripe customer if one already exists (RLS scopes the
  // read to the tenant's own subscription row).
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("tenant_id", me.tenant_id)
    .maybeSingle();

  try {
    const priceId = resolvePriceId(parsed.data.plan, parsed.data.interval);
    const session = await createCheckoutSession({
      priceId,
      tenantId: me.tenant_id,
      plan: parsed.data.plan,
      interval: parsed.data.interval,
      customerEmail: me.email ?? user.email ?? "",
      stripeCustomerId: sub?.stripe_customer_id ?? null
    });
    return NextResponse.json({ url: session.url });
  } catch {
    return NextResponse.json({ error: "تعذّر بدء عملية الدفع" }, { status: 500 });
  }
}
