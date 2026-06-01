import type { PaymentProvider, CheckoutInput, CheckoutOutput, WebhookOutcome } from "../types";
import { createTapCharge } from "./checkout";
import { verifyTapWebhook } from "./webhook";

// AC-6.1 / AC-6.2 / AC-6.3 — the Tap rail as a PaymentProvider. createCheckout
// opens a Tap Hosted Payment Page charge; verifyWebhook validates the HMAC
// signature and reduces a captured charge to the shared activation outcome.
export const tapProvider: PaymentProvider = {
  name: "tap",

  async createCheckout(input: CheckoutInput): Promise<CheckoutOutput> {
    const charge = await createTapCharge({
      tenantId: input.tenantId,
      plan: input.plan,
      interval: input.interval,
      currency: input.currency,
      customerEmail: input.customerEmail
    });
    return { url: charge.url };
  },

  async verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookOutcome | null> {
    return verifyTapWebhook(rawBody, headers);
  }
};
