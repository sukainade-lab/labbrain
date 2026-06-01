import type { PlanId, Interval } from "@/lib/pricing/plans";
import type { Currency } from "@/lib/pricing/currency";

// AC-6.1 — the provider-neutral payment contract. Both rails (Stripe, Tap) sit
// behind this interface so /api/checkout can route by currency (pickProvider) and
// both webhooks reduce to the SAME set of DB effects (activation-core).

export type ProviderName = "stripe" | "tap";

// What a captured/active subscription looks like, independent of the provider.
// Persisted via the provider-aware upsert RPC (migration 0008). For the 'stripe'
// provider the RPC also mirrors these into the legacy stripe_* columns.
export interface SubscriptionRecord {
  tenantId: string;
  provider: ProviderName;
  providerCustomerId: string | null;
  providerSubscriptionId: string;
  currency: string;
  plan: string | null;
  interval: string | null;
  status: string;
}

export interface CheckoutInput {
  tenantId: string;
  plan: PlanId;
  interval: Interval;
  currency: Currency;
  customerEmail: string;
  /** Reuse an existing provider customer for this tenant when known. */
  providerCustomerId?: string | null;
}

export interface CheckoutOutput {
  /** The hosted payment page URL the client redirects to. */
  url: string | null;
}

// The normalized outcome of a verified webhook, mapped to DB effects by
// activation-core.applyOutcome. Both rails produce these from their own payloads.
export type WebhookOutcome =
  | { kind: "ignore" }
  | { kind: "activate"; tenantId: string; plan: string | null; record: SubscriptionRecord | null }
  | { kind: "deactivate"; provider: ProviderName; providerSubscriptionId: string }
  | { kind: "past_due"; provider: ProviderName; providerSubscriptionId: string };

export interface PaymentProvider {
  readonly name: ProviderName;
  createCheckout(input: CheckoutInput): Promise<CheckoutOutput>;
  /**
   * Verify a raw webhook request and reduce it to a provider-neutral outcome.
   * Returns `null` when the signature is missing or invalid — the route then
   * responds 400 and applies nothing.
   */
  verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookOutcome | null>;
}
