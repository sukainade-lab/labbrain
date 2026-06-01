import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tapHashstring, signTapHashstring, verifyTapWebhook } from "@/lib/payment/tap/webhook";

// Story 6 — Tap webhook signature verification (AC-6.3). Security-critical: the
// hashstring is HMAC-SHA256 over a fixed-order field string keyed by the secret
// API key, and the amount is formatted to the currency's decimals. A forged or
// tampered body must never produce an outcome; only a CAPTURED charge activates.

const SECRET = "sk_test_secret";

// A representative captured JOD charge (only the signed fields + our metadata).
function capturedCharge(overrides: Record<string, unknown> = {}) {
  return {
    id: "chg_abc",
    amount: 35, // JOD → must hash as "35.000"
    currency: "JOD",
    status: "CAPTURED",
    reference: { gateway: "gw_1", payment: "pmt_1" },
    transaction: { created: "1717000000000" },
    customer: { id: "cus_1" },
    metadata: { tenant_id: "t1", plan: "starter", interval: "month" },
    ...overrides
  };
}

function headersWith(sig: string): Headers {
  return new Headers({ hashstring: sig });
}

function signedRequest(charge: object): { body: string; headers: Headers } {
  const body = JSON.stringify(charge);
  const sig = signTapHashstring(tapHashstring(charge));
  return { body, headers: headersWith(sig) };
}

describe("@AC-6.3 Tap webhook signature", () => {
  beforeEach(() => {
    process.env.TAP_SECRET_KEY = SECRET;
  });
  afterEach(() => {
    delete process.env.TAP_SECRET_KEY;
  });

  it("formats the amount to the currency's decimals in the hashstring (JOD = 3)", () => {
    expect(tapHashstring(capturedCharge())).toContain("x_amount35.000");
  });

  it("a valid signature on a CAPTURED charge → activate outcome", () => {
    const charge = capturedCharge();
    const { body, headers } = signedRequest(charge);
    const outcome = verifyTapWebhook(body, headers);
    expect(outcome).toEqual({
      kind: "activate",
      tenantId: "t1",
      plan: "starter",
      record: {
        tenantId: "t1",
        provider: "tap",
        providerCustomerId: "cus_1",
        providerSubscriptionId: "chg_abc",
        currency: "JOD",
        plan: "starter",
        interval: "month",
        status: "active"
      }
    });
  });

  it("a missing hashstring header → null (route responds 400)", () => {
    const charge = capturedCharge();
    expect(verifyTapWebhook(JSON.stringify(charge), new Headers())).toBeNull();
  });

  it("a tampered amount (body changed after signing) → null", () => {
    const charge = capturedCharge();
    const sig = signTapHashstring(tapHashstring(charge));
    // Attacker inflates nothing but mutates the body the signature was computed over.
    const tampered = JSON.stringify({ ...charge, amount: 1 });
    expect(verifyTapWebhook(tampered, headersWith(sig))).toBeNull();
  });

  it("a forged signature → null", () => {
    const charge = capturedCharge();
    expect(verifyTapWebhook(JSON.stringify(charge), headersWith("deadbeef"))).toBeNull();
  });

  it("a non-CAPTURED charge with a valid signature → ignore (activates nothing)", () => {
    const charge = capturedCharge({ status: "DECLINED" });
    const { body, headers } = signedRequest(charge);
    expect(verifyTapWebhook(body, headers)).toEqual({ kind: "ignore" });
  });

  it("returns null when TAP_SECRET_KEY is unset (cannot verify → reject)", () => {
    const charge = capturedCharge();
    const { body, headers } = signedRequest(charge);
    delete process.env.TAP_SECRET_KEY;
    expect(verifyTapWebhook(body, headers)).toBeNull();
  });
});
