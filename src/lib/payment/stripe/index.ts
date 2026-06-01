import Stripe from "stripe";

// Founder override: Stripe selected despite BRD's JOD/Jordan caveat (assumes a
// Stripe entity in a supported country). Tap/bank-transfer retained as fallback.
//
// Lazily instantiated: Stripe v17 throws on an empty API key, which would break
// `next build` page-data collection where env vars are absent. The Proxy defers
// construction until the first real property access at request time.
let client: Stripe | null = null;

function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not set — cannot make Stripe calls.");
    }
    client = new Stripe(key, { apiVersion: "2025-02-24.acacia" });
  }
  return client;
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    return Reflect.get(getStripe(), prop, receiver);
  }
});
