import { describe, it, expect } from "vitest";
import { pickProvider, getProvider } from "@/lib/payment/router";

// Story 6 — provider router (AC-6.1). The whole point of S6: JOD/KWD/SAR card
// payments must go to Tap (Stripe cannot settle JOD for a Jordan entity), while
// everything else — and, critically, an ABSENT currency — stays on Stripe so the
// shipped S4 money loop is unchanged (zero behavior change). The pricing UI is
// what defaults the user-facing currency to JOD → Tap (AC-6.6).

describe("@AC-6.1 pickProvider routes by currency", () => {
  it("routes the Gulf/JOD currencies to Tap", () => {
    expect(pickProvider("JOD")).toBe("tap");
    expect(pickProvider("KWD")).toBe("tap");
    expect(pickProvider("SAR")).toBe("tap");
  });

  it("routes any other currency to Stripe", () => {
    expect(pickProvider("USD")).toBe("stripe");
    expect(pickProvider("EUR")).toBe("stripe");
  });

  it("falls back to Stripe when no currency is given (S4 backward compatibility)", () => {
    expect(pickProvider(undefined)).toBe("stripe");
    expect(pickProvider("")).toBe("stripe");
  });
});

describe("@AC-6.1 getProvider returns a PaymentProvider implementation", () => {
  it("returns the Stripe provider exposing the interface", () => {
    const p = getProvider("stripe");
    expect(p.name).toBe("stripe");
    expect(typeof p.createCheckout).toBe("function");
    expect(typeof p.verifyWebhook).toBe("function");
  });

  it("returns the Tap provider exposing the interface", () => {
    const p = getProvider("tap");
    expect(p.name).toBe("tap");
    expect(typeof p.createCheckout).toBe("function");
    expect(typeof p.verifyWebhook).toBe("function");
  });
});
