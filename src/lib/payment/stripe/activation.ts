import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { applyOutcome } from "../activation-core";
import type { SubscriptionRecord, WebhookOutcome } from "../types";

type Admin = ReturnType<typeof createAdminClient>;

// Stripe's generated Invoice type doesn't always surface `subscription` on the
// version we pin, though the API sends it. Narrow it once here instead of an
// inline cast at the call site.
type InvoiceWithSubscription = Stripe.Invoice & {
  subscription?: string | { id: string } | null;
};

// AC-4.3 / AC-6.1 — apply a verified Stripe event to our DB. The Stripe rail now
// maps its event to the provider-neutral `WebhookOutcome` (stripeEventToOutcome)
// and hands it to the shared reducer (applyOutcome) — the SAME effects Tap uses.
// The signature is unchanged so the S4 webhook route + live test are untouched.
export async function handleStripeEvent(admin: Admin, event: Stripe.Event): Promise<void> {
  await applyOutcome(admin, stripeEventToOutcome(event));
}

// Pure mapping from a verified Stripe event → provider-neutral outcome. Shared by
// both the legacy handleStripeEvent entrypoint and stripeProvider.verifyWebhook,
// so there is exactly one place that interprets Stripe payloads.
export function stripeEventToOutcome(event: Stripe.Event): WebhookOutcome {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const tenantId = session.client_reference_id ?? session.metadata?.tenant_id ?? null;
      if (!tenantId) throw new Error("checkout.session.completed without a tenant id");

      const plan = session.metadata?.plan ?? null;
      const interval = session.metadata?.interval ?? null;
      const customerId = idOf(session.customer);
      const subscriptionId = idOf(session.subscription);
      const currency = session.currency ? session.currency.toUpperCase() : "JOD";

      // Only build a subscription record when Stripe gave us a subscription id to
      // key the upsert on; a bare activation still flips the access gate.
      const record: SubscriptionRecord | null = subscriptionId
        ? {
            tenantId,
            provider: "stripe",
            providerCustomerId: customerId,
            providerSubscriptionId: subscriptionId,
            currency,
            plan,
            interval,
            status: "active"
          }
        : null;

      return { kind: "activate", tenantId, plan, record };
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      return { kind: "deactivate", provider: "stripe", providerSubscriptionId: sub.id };
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as InvoiceWithSubscription;
      const subId = idOf(invoice.subscription);
      if (!subId) return { kind: "ignore" };
      return { kind: "past_due", provider: "stripe", providerSubscriptionId: subId };
    }
    default:
      // Unhandled event types are acknowledged (200) but do nothing.
      return { kind: "ignore" };
  }
}

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}
