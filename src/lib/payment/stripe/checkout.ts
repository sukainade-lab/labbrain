import { stripe } from "./index";

// AC-4.2 — create a Stripe Checkout session for a tenant subscribing to a plan.
// Returns the hosted Checkout URL the client redirects to.
export async function createCheckoutSession(opts: {
  priceId: string;
  tenantId: string;
  customerEmail: string;
}) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: opts.priceId, quantity: 1 }],
    customer_email: opts.customerEmail,
    client_reference_id: opts.tenantId,
    metadata: { tenant_id: opts.tenantId },
    success_url: `${appUrl}/dashboard?checkout=success`,
    cancel_url: `${appUrl}/pricing?checkout=cancelled`
  });

  return { id: session.id, url: session.url };
}
