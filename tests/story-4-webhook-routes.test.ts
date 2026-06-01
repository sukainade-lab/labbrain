import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Story 4 — Stripe webhook HTTP seam (AC-4.3, Lesson L1). Verifies the signature
// gate and event dispatch. constructEvent + handleStripeEvent are mocked here;
// the real DB activation is covered live in tests/story-4-webhook.test.ts.

const h = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  handle: vi.fn()
}));

vi.mock("@/lib/payment/stripe", () => ({
  stripe: { webhooks: { constructEvent: h.constructEvent } }
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/payment/stripe/activation", () => ({ handleStripeEvent: h.handle }));

import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";

function call(headers: Record<string, string>, body = "{}") {
  return webhookPOST(
    new NextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers,
      body
    })
  );
}

describe("Story 4 — /api/stripe/webhook route handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  });

  it("@AC-4.3 missing stripe-signature header → 400, never dispatches", async () => {
    const res = await call({});
    expect(res.status).toBe(400);
    expect(h.handle).not.toHaveBeenCalled();
  });

  it("@AC-4.3 missing webhook secret → 400", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await call({ "stripe-signature": "t=1,v1=abc" });
    expect(res.status).toBe(400);
    expect(h.handle).not.toHaveBeenCalled();
  });

  it("@AC-4.3 a forged signature is rejected → 400, never dispatches", async () => {
    h.constructEvent.mockImplementationOnce(() => {
      throw new Error("No signatures found matching the expected signature");
    });
    const res = await call({ "stripe-signature": "t=1,v1=forged" });
    expect(res.status).toBe(400);
    expect(h.handle).not.toHaveBeenCalled();
  });

  it("@AC-4.3 a valid event → 200 and is dispatched once", async () => {
    const event = { type: "checkout.session.completed", data: { object: {} } };
    h.constructEvent.mockReturnValueOnce(event);
    h.handle.mockResolvedValueOnce(undefined);
    const res = await call({ "stripe-signature": "t=1,v1=good" });
    expect(res.status).toBe(200);
    expect(h.handle).toHaveBeenCalledTimes(1);
    expect(h.handle.mock.calls[0][1]).toBe(event);
  });

  // The seam must forward EVERY lifecycle event to the handler, not just
  // checkout.session.completed — the route does no type filtering, so a
  // regression that special-cased one type would be caught here.
  it.each([
    "customer.subscription.deleted",
    "invoice.payment_failed"
  ])("@AC-4.3 forwards %s to the handler verbatim → 200", async (type) => {
    const event = { type, data: { object: {} } };
    h.constructEvent.mockReturnValueOnce(event);
    h.handle.mockResolvedValueOnce(undefined);
    const res = await call({ "stripe-signature": "t=1,v1=good" });
    expect(res.status).toBe(200);
    expect(h.handle).toHaveBeenCalledTimes(1);
    expect(h.handle.mock.calls[0][1]).toBe(event);
  });

  it("@AC-4.3 a handler failure → 500 (so Stripe retries the idempotent handler)", async () => {
    h.constructEvent.mockReturnValueOnce({ type: "checkout.session.completed", data: { object: {} } });
    h.handle.mockRejectedValueOnce(new Error("db down"));
    const res = await call({ "stripe-signature": "t=1,v1=good" });
    expect(res.status).toBe(500);
  });
});
