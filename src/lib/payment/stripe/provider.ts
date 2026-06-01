import type { PaymentProvider, CheckoutInput, CheckoutOutput, WebhookOutcome } from "../types";
import { stripe } from "./index";
import { resolvePriceId } from "./prices";
import { createCheckoutSession } from "./checkout";
import { stripeEventToOutcome } from "./activation";

// AC-6.1 — the Stripe rail as a PaymentProvider. This is a thin adapter over the
// existing S4 building blocks (resolvePriceId + createCheckoutSession + the event
// mapper) so the shipped Stripe money loop is unchanged — it just now sits behind
// the provider-neutral interface the router selects.
export const stripeProvider: PaymentProvider = {
  name: "stripe",

  async createCheckout(input: CheckoutInput): Promise<CheckoutOutput> {
    const priceId = resolvePriceId(input.plan, input.interval);
    const session = await createCheckoutSession({
      priceId,
      tenantId: input.tenantId,
      plan: input.plan,
      interval: input.interval,
      customerEmail: input.customerEmail,
      stripeCustomerId: input.providerCustomerId ?? null
    });
    return { url: session.url };
  },

  async verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookOutcome | null> {
    const sig = headers.get("stripe-signature");
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!sig || !secret) return null;
    try {
      const event = stripe.webhooks.constructEvent(rawBody, sig, secret);
      return stripeEventToOutcome(event);
    } catch {
      // Missing/invalid signature → caller responds 400 and applies nothing.
      return null;
    }
  }
};
