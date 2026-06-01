import { stripe } from "./index";

// AC-4.2 — create a Stripe Checkout session for a tenant subscribing to a plan.
// Returns the hosted Checkout URL the client redirects to.
export async function createCheckoutSession(opts: {
  priceId: string;
  tenantId: string;
  plan: string;
  interval: string;
  customerEmail: string;
  /** Reuse an existing Stripe customer for this tenant when known. */
  stripeCustomerId?: string | null;
}) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: opts.priceId, quantity: 1 }],
    // Reuse the tenant's existing Stripe customer when we have one — avoids
    // creating a duplicate customer on every re-subscribe. Otherwise let
    // Checkout create one from the email.
    ...(opts.stripeCustomerId
      ? { customer: opts.stripeCustomerId }
      : { customer_email: opts.customerEmail }),
    client_reference_id: opts.tenantId,
    // tenant_id resolves the tenant on checkout.session.completed; plan/interval
    // let the webhook record what was bought without reverse-mapping the price.
    metadata: { tenant_id: opts.tenantId, plan: opts.plan, interval: opts.interval },
    success_url: `${appUrl}/dashboard?checkout=success`,
    cancel_url: `${appUrl}/pricing?checkout=cancelled`
  });

  return { id: session.id, url: session.url };
}
