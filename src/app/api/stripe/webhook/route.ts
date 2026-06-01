import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/payment/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleStripeEvent } from "@/lib/payment/stripe/activation";

// AC-4.3 — Stripe webhook: signature-verified, then applied to the DB.
// checkout.session.completed → activate; subscription.deleted → inactive;
// invoice.payment_failed → past_due. Idempotent (see activation.ts).
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return NextResponse.json({ error: "missing signature/secret" }, { status: 400 });
  }

  const body = await req.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    return NextResponse.json(
      { error: `webhook signature verification failed: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  try {
    await handleStripeEvent(createAdminClient(), event);
  } catch {
    // Return 500 so Stripe retries; the handlers are idempotent, so a retry is safe.
    return NextResponse.json({ error: "webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
