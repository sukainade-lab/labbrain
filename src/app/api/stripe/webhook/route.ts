import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/payment/stripe";

// AC-4.3 — Stripe webhook: signature-verified; activates/deactivates tenants.
// Stub: signature verification + event routing are wired; tenant DB writes land in S4 implementation.
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

  switch (event.type) {
    case "checkout.session.completed":
      // TODO(S4): set tenant plan status = 'active', upsert subscriptions row, send activation email.
      break;
    case "customer.subscription.deleted":
      // TODO(S4): set tenant status = 'inactive'.
      break;
    case "invoice.payment_failed":
      // TODO(S4): set tenant status = 'past_due'.
      break;
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
