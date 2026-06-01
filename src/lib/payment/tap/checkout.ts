import { tapFetch } from "./index";
import { amountFor, type Currency } from "@/lib/pricing/currency";
import type { PlanId, Interval } from "@/lib/pricing/plans";

// AC-6.2 — create a Tap Hosted Payment Page (HPP) charge for a plan×interval.
// The amount is derived from the pricing source of truth (amountFor → plans.ts for
// JOD; founder price points for KWD/SAR) — never hardcoded. Returns the HPP URL
// the client redirects to. MVP = a per-interval charge (no saved-card recurring;
// Tap subscriptions are an S6 follow-up).
export async function createTapCharge(opts: {
  tenantId: string;
  plan: PlanId;
  interval: Interval;
  currency: Currency;
  customerEmail: string;
}): Promise<{ id: string; url: string | null }> {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const amount = amountFor(opts.plan, opts.interval, opts.currency);

  const charge = (await tapFetch("/charges", {
    method: "POST",
    body: {
      amount,
      currency: opts.currency,
      threeDSecure: true,
      // src_all = let Tap's HPP present every enabled card method (mada/Visa/MC).
      source: { id: "src_all" },
      customer: { email: opts.customerEmail },
      // redirect = where the cardholder lands after paying (no signature there →
      // the webhook is the activation source of truth). post = the webhook URL.
      redirect: { url: `${appUrl}/dashboard?checkout=success` },
      post: { url: `${appUrl}/api/webhooks/tap` },
      // tenant_id resolves the tenant on the webhook; plan/interval record what was
      // bought without reverse-mapping the amount.
      metadata: { tenant_id: opts.tenantId, plan: opts.plan, interval: opts.interval }
    }
  })) as { id: string; transaction?: { url?: string | null } };

  return { id: charge.id, url: charge.transaction?.url ?? null };
}
