import { describe, it, expect, afterEach } from "vitest";
import {
  CURRENCY_DECIMALS,
  DEFAULT_CURRENCY,
  isSupportedCurrency,
  formatAmount,
  amountFor
} from "@/lib/pricing/currency";
import { intervalTotal, getPlan } from "@/lib/pricing/plans";

// Story 6 — currency module (AC-6.5). The per-currency decimals are not cosmetic:
// JOD & KWD settle in 3-decimal fils, SAR in 2-decimal halalas, and Tap's webhook
// hashstring is computed over the amount formatted to EXACTLY the currency's
// decimals — a wrong exponent makes every signature check fail (AC-6.3). JOD is
// the live default; KWD/SAR must be founder-configured price points, never an FX
// guess, so amountFor throws until they are set.

const KWD_SAR_ENV_KEYS = [
  "TAP_PRICE_STARTER_MONTH_KWD",
  "TAP_PRICE_STARTER_YEAR_KWD",
  "TAP_PRICE_PRO_MONTH_KWD",
  "TAP_PRICE_PRO_YEAR_KWD",
  "TAP_PRICE_STARTER_MONTH_SAR",
  "TAP_PRICE_STARTER_YEAR_SAR",
  "TAP_PRICE_PRO_MONTH_SAR",
  "TAP_PRICE_PRO_YEAR_SAR"
];

afterEach(() => {
  for (const k of KWD_SAR_ENV_KEYS) delete process.env[k];
});

describe("@AC-6.5 currency decimals + support", () => {
  it("uses the ISO 4217 minor-unit exponent per currency (JOD 3, KWD 3, SAR 2)", () => {
    expect(CURRENCY_DECIMALS.JOD).toBe(3);
    expect(CURRENCY_DECIMALS.KWD).toBe(3);
    expect(CURRENCY_DECIMALS.SAR).toBe(2);
  });

  it("defaults to JOD (the Amman beachhead currency)", () => {
    expect(DEFAULT_CURRENCY).toBe("JOD");
  });

  it("recognises only the three supported currencies", () => {
    expect(isSupportedCurrency("JOD")).toBe(true);
    expect(isSupportedCurrency("KWD")).toBe(true);
    expect(isSupportedCurrency("SAR")).toBe(true);
    expect(isSupportedCurrency("USD")).toBe(false);
    expect(isSupportedCurrency("jod")).toBe(false);
    expect(isSupportedCurrency("")).toBe(false);
  });
});

describe("@AC-6.5 formatAmount pads to the currency's decimals", () => {
  it("formats JOD/KWD to 3 decimals", () => {
    expect(formatAmount(35, "JOD")).toBe("35.000");
    expect(formatAmount(26.25, "JOD")).toBe("26.250");
    expect(formatAmount(70, "KWD")).toBe("70.000");
  });

  it("formats SAR to 2 decimals", () => {
    expect(formatAmount(70, "SAR")).toBe("70.00");
    expect(formatAmount(52.5, "SAR")).toBe("52.50");
  });
});

describe("@AC-6.5 amountFor derives JOD from the pricing source of truth", () => {
  it("returns the monthly price for JOD month", () => {
    expect(amountFor("starter", "month", "JOD")).toBe(intervalTotal(getPlan("starter"), "month"));
    expect(amountFor("pro", "month", "JOD")).toBe(70);
  });

  it("returns the discounted annual total for JOD year", () => {
    // pro: 70 × 12 × 0.75 = 630
    expect(amountFor("pro", "year", "JOD")).toBe(intervalTotal(getPlan("pro"), "year"));
    expect(amountFor("pro", "year", "JOD")).toBe(630);
  });

  it("defaults to JOD when no currency is given", () => {
    expect(amountFor("starter", "month")).toBe(35);
  });
});

describe("@AC-6.5 KWD/SAR are founder-configured price points (no FX guessing)", () => {
  it("throws a clear error when a KWD price point is unset", () => {
    expect(() => amountFor("pro", "month", "KWD")).toThrow(/TAP_PRICE_PRO_MONTH_KWD/);
  });

  it("throws a clear error when a SAR price point is unset", () => {
    expect(() => amountFor("starter", "year", "SAR")).toThrow(/TAP_PRICE_STARTER_YEAR_SAR/);
  });

  it("returns the configured KWD/SAR amount when the env price point is set", () => {
    process.env.TAP_PRICE_PRO_MONTH_KWD = "22.5";
    process.env.TAP_PRICE_STARTER_YEAR_SAR = "315";
    expect(amountFor("pro", "month", "KWD")).toBe(22.5);
    expect(amountFor("starter", "year", "SAR")).toBe(315);
  });

  it("rejects a non-numeric or non-positive configured amount", () => {
    process.env.TAP_PRICE_PRO_MONTH_SAR = "not-a-number";
    expect(() => amountFor("pro", "month", "SAR")).toThrow(/TAP_PRICE_PRO_MONTH_SAR/);
    process.env.TAP_PRICE_PRO_MONTH_SAR = "0";
    expect(() => amountFor("pro", "month", "SAR")).toThrow(/TAP_PRICE_PRO_MONTH_SAR/);
  });
});
