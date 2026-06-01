import type { PlanId, Interval } from "@/lib/pricing/plans";

// AC-4.2 — map plan × interval → the Stripe Price ID. Price IDs are
// founder-provided configuration (created in the Stripe dashboard), read from
// env and never hardcoded. See .env.example / docs/env-contract.md.
const ENV_KEYS: Record<PlanId, Record<Interval, string>> = {
  starter: {
    month: "STRIPE_PRICE_STARTER_MONTH",
    year: "STRIPE_PRICE_STARTER_YEAR"
  },
  pro: {
    month: "STRIPE_PRICE_PRO_MONTH",
    year: "STRIPE_PRICE_PRO_YEAR"
  }
};

export function resolvePriceId(plan: PlanId, interval: Interval): string {
  const key = ENV_KEYS[plan]?.[interval];
  if (!key) throw new Error(`no Stripe price mapping for ${plan}/${interval}`);
  const id = process.env[key];
  if (!id) {
    throw new Error(`${key} is not set — cannot start checkout for ${plan}/${interval}`);
  }
  return id;
}
