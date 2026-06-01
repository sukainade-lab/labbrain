import Stripe from "stripe";

// Founder override: Stripe selected despite BRD's JOD/Jordan caveat (assumes a
// Stripe entity in a supported country). Tap/bank-transfer retained as fallback.
const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  // Surface misconfiguration loudly at boot rather than failing mid-checkout.
  console.warn("STRIPE_SECRET_KEY is not set — Stripe calls will fail until configured.");
}

export const stripe = new Stripe(key ?? "", {
  apiVersion: "2024-09-30.acacia"
});
