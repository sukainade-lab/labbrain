import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolvePriceId } from "@/lib/payment/stripe/prices";

// Story 4 — checkout HTTP seam (Lesson L1) + price-id resolution unit tests.
// The cookie-bound server client is mocked to supply the authenticated user,
// tenant lookup, and existing-subscription lookup. createCheckoutSession is
// mocked so no real Stripe call is made; resolvePriceId runs for real against
// env so the route's plan→price wiring is exercised end-to-end.

const PRICE_ENV = {
  STRIPE_PRICE_STARTER_MONTH: "price_starter_m",
  STRIPE_PRICE_STARTER_YEAR: "price_starter_y",
  STRIPE_PRICE_PRO_MONTH: "price_pro_m",
  STRIPE_PRICE_PRO_YEAR: "price_pro_y"
} as const;

describe("@AC-4.2 resolvePriceId", () => {
  beforeEach(() => {
    Object.assign(process.env, PRICE_ENV);
  });
  afterEach(() => {
    for (const k of Object.keys(PRICE_ENV)) delete process.env[k];
  });

  it("maps each plan×interval to its env price id", () => {
    expect(resolvePriceId("starter", "month")).toBe("price_starter_m");
    expect(resolvePriceId("starter", "year")).toBe("price_starter_y");
    expect(resolvePriceId("pro", "month")).toBe("price_pro_m");
    expect(resolvePriceId("pro", "year")).toBe("price_pro_y");
  });

  it("throws a clear error when the price env is missing", () => {
    delete process.env.STRIPE_PRICE_PRO_YEAR;
    expect(() => resolvePriceId("pro", "year")).toThrow(/STRIPE_PRICE_PRO_YEAR/);
  });
});

const h = vi.hoisted(() => ({
  state: {
    user: null as { id: string; email?: string } | null,
    me: null as { tenant_id: string; email: string } | null,
    sub: null as { stripe_customer_id: string | null } | null
  }
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.state.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: h.state.me }),
          maybeSingle: async () => ({ data: h.state.sub })
        })
      })
    })
  })
}));

vi.mock("@/lib/payment/stripe/checkout", () => ({
  createCheckoutSession: vi.fn()
}));

import { POST as checkoutPOST } from "@/app/api/checkout/route";
import { createCheckoutSession } from "@/lib/payment/stripe/checkout";

function postCheckout(body: unknown) {
  return checkoutPOST(
    new Request("http://localhost/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  );
}

describe("Story 4 — /api/checkout route handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.user = null;
    h.state.me = null;
    h.state.sub = null;
    Object.assign(process.env, PRICE_ENV);
  });
  afterEach(() => {
    for (const k of Object.keys(PRICE_ENV)) delete process.env[k];
  });

  it("@AC-4.2 unauthenticated → 401, never creates a session", async () => {
    const res = await postCheckout({ plan: "starter" });
    expect(res.status).toBe(401);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("@AC-4.2 bad body → 400", async () => {
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: "t1", email: "a@lab.jo" };
    const res = await postCheckout({ plan: "enterprise" });
    expect(res.status).toBe(400);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("@AC-4.2 authed → 200 with checkout URL, resolves price + tenant", async () => {
    h.state.user = { id: "u1", email: "a@lab.jo" };
    h.state.me = { tenant_id: "t1", email: "a@lab.jo" };
    vi.mocked(createCheckoutSession).mockResolvedValueOnce({
      id: "cs_1",
      url: "https://checkout.stripe/x"
    });
    const res = await postCheckout({ plan: "pro", interval: "year" });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.url).toBe("https://checkout.stripe/x");
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createCheckoutSession).mock.calls[0][0]).toMatchObject({
      priceId: "price_pro_y",
      tenantId: "t1",
      stripeCustomerId: null
    });
  });

  it("@AC-4.2 reuses an existing Stripe customer id (no duplicate customers)", async () => {
    h.state.user = { id: "u1", email: "a@lab.jo" };
    h.state.me = { tenant_id: "t1", email: "a@lab.jo" };
    h.state.sub = { stripe_customer_id: "cus_existing" };
    vi.mocked(createCheckoutSession).mockResolvedValueOnce({ id: "cs_2", url: "u" });
    await postCheckout({ plan: "starter", interval: "month" });
    expect(vi.mocked(createCheckoutSession).mock.calls[0][0]).toMatchObject({
      stripeCustomerId: "cus_existing",
      priceId: "price_starter_m"
    });
  });

  it("@AC-4.2 missing price env → 500 (never a broken Checkout)", async () => {
    h.state.user = { id: "u1", email: "a@lab.jo" };
    h.state.me = { tenant_id: "t1", email: "a@lab.jo" };
    delete process.env.STRIPE_PRICE_PRO_MONTH;
    const res = await postCheckout({ plan: "pro", interval: "month" });
    expect(res.status).toBe(500);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });
});
