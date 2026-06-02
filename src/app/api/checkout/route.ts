import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { pickProvider, getProvider } from "@/lib/payment/router";
import { isSupportedCurrency, DEFAULT_CURRENCY, type Currency } from "@/lib/pricing/currency";
import { captureError } from "@/lib/observability/log";

// AC-4.2 / AC-6.2 — start a checkout for the signed-in tenant. The provider is
// chosen by currency (AC-6.1 pickProvider): JOD/KWD/SAR → Tap, else Stripe. An
// ABSENT currency stays on Stripe so the shipped S4 loop is unchanged. Auth is
// required; the marketing CTA routes unauthenticated visitors to /signup?plan=
// first, and this handler returns 401 if they reach it anyway.
const checkoutSchema = z.object({
  plan: z.enum(["starter", "pro"]),
  interval: z.enum(["month", "year"]).default("month"),
  // Optional: the pricing UI sends the user-facing currency (JOD default → Tap).
  currency: z.string().optional()
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

  // Reuse this tenant's existing provider customer if one already exists (RLS
  // scopes the read to the tenant's own subscription row).
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("tenant_id", me.tenant_id)
    .maybeSingle();

  // Route by the raw user-facing currency; pass a typed Currency into the provider
  // (Stripe ignores it — it bills by price id; Tap charges in it).
  const rawCurrency = parsed.data.currency;
  const provider = getProvider(pickProvider(rawCurrency));
  const currency: Currency = isSupportedCurrency(rawCurrency ?? "")
    ? (rawCurrency as Currency)
    : DEFAULT_CURRENCY;

  try {
    const { url } = await provider.createCheckout({
      tenantId: me.tenant_id,
      plan: parsed.data.plan,
      interval: parsed.data.interval,
      currency,
      customerEmail: me.email ?? user.email ?? "",
      providerCustomerId: sub?.stripe_customer_id ?? null
    });
    return NextResponse.json({ url });
  } catch (err) {
    captureError("checkout", err);
    return NextResponse.json({ error: "تعذّر بدء عملية الدفع" }, { status: 500 });
  }
}
