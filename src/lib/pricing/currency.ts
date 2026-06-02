import { getPlan, intervalTotal, type PlanId, type Interval } from "./plans";

// AC-6.5 — currency module for the Tap rail (JOD + KWD + SAR).
//
// Two responsibilities:
//   1. Per-currency decimals. JOD & KWD settle in 3-decimal minor units (fils);
//      SAR in 2-decimal (halalas). Tap's webhook hashstring is computed over the
//      amount formatted to EXACTLY these decimals (AC-6.3), so this table is also
//      the signature contract — a wrong exponent breaks every verification.
//   2. Amount resolution. JOD is the live default and is derived from the pricing
//      source of truth (lib/pricing/plans) — no second copy of the prices. KWD &
//      SAR have NO defensible FX conversion, so they are founder-configured price
//      points read from env; amountFor THROWS until they are set, by design.

export type Currency = "JOD" | "KWD" | "SAR";

export const DEFAULT_CURRENCY: Currency = "JOD";

// ISO 4217 minor-unit exponents.
export const CURRENCY_DECIMALS: Record<Currency, number> = {
  JOD: 3,
  KWD: 3,
  SAR: 2
};

export function isSupportedCurrency(c: string): c is Currency {
  return Object.prototype.hasOwnProperty.call(CURRENCY_DECIMALS, c);
}

// Format a major-unit amount to the currency's fixed decimals. Used for display
// AND for the Tap hashstring (AC-6.3), so it must be deterministic.
export function formatAmount(amount: number, currency: Currency): string {
  return amount.toFixed(CURRENCY_DECIMALS[currency]);
}

// KWD/SAR price points are founder configuration (like Stripe price ids), read
// from env and never hardcoded or FX-converted. See docs/env-contract.md.
function configuredAmount(plan: PlanId, interval: Interval, currency: Currency): number {
  const key = `TAP_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}_${currency}`;
  const raw = process.env[key];
  if (!raw) {
    throw new Error(
      `${key} is not set — ${currency} pricing must be a founder-provided price point (no FX guessing).`
    );
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${key} is not a valid positive amount: ${raw}`);
  }
  return n;
}

// Major-unit amount for a plan × interval in the given currency.
//   • JOD  → derived from the pricing source of truth (plans.ts).
//   • KWD/SAR → founder-configured env price point (throws if unset).
export function amountFor(
  plan: PlanId,
  interval: Interval,
  currency: Currency = DEFAULT_CURRENCY
): number {
  if (currency === "JOD") return intervalTotal(getPlan(plan), interval);
  return configuredAmount(plan, interval, currency);
}
