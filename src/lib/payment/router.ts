import type { ProviderName, PaymentProvider } from "./types";
import { stripeProvider } from "./stripe/provider";
import { tapProvider } from "./tap/provider";

// AC-6.1 — route a checkout to the right rail by currency. Stripe cannot settle
// JOD for a Jordan entity, so the Gulf currencies go to Tap; everything else —
// and, critically, an ABSENT currency — stays on Stripe so the shipped S4 money
// loop is unchanged (the S4 checkout POST sends no currency).
const TAP_CURRENCIES = new Set<string>(["JOD", "KWD", "SAR"]);

export function pickProvider(currency?: string | null): ProviderName {
  if (currency && TAP_CURRENCIES.has(currency)) return "tap";
  return "stripe";
}

export function getProvider(name: ProviderName): PaymentProvider {
  return name === "tap" ? tapProvider : stripeProvider;
}
