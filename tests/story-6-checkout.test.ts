import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Story 6 — the /api/checkout provider switch (AC-6.1 pickProvider, Lesson L1
// route-handler coverage). Both checkout seams are mocked so no real provider call
// is made. The route test proves JOD routes to Tap, USD/absent stays on Stripe
// (the S4 loop is unchanged). The real createTapCharge lives in story-6-tap-charge.

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

vi.mock("@/lib/payment/tap/checkout", () => ({ createTapCharge: vi.fn() }));
vi.mock("@/lib/payment/stripe/checkout", () => ({ createCheckoutSession: vi.fn() }));

import { POST as checkoutPOST } from "@/app/api/checkout/route";
import { createTapCharge } from "@/lib/payment/tap/checkout";
import { createCheckoutSession } from "@/lib/payment/stripe/checkout";

const STRIPE_PRICE_ENV = {
  STRIPE_PRICE_STARTER_MONTH: "price_starter_m",
  STRIPE_PRICE_PRO_YEAR: "price_pro_y"
} as const;

function postCheckout(body: unknown) {
  return checkoutPOST(
    new Request("http://localhost/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

describe("@AC-6.1 /api/checkout routes by currency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.user = { id: "u1", email: "a@lab.jo" };
    h.state.me = { tenant_id: "t1", email: "a@lab.jo" };
    h.state.sub = null;
    Object.assign(process.env, STRIPE_PRICE_ENV);
  });
  afterEach(() => {
    for (const k of Object.keys(STRIPE_PRICE_ENV)) delete process.env[k];
  });

  it("currency JOD → Tap (Stripe untouched)", async () => {
    vi.mocked(createTapCharge).mockResolvedValueOnce({ id: "chg_1", url: "https://tap.hpp/x" });
    const res = await postCheckout({ plan: "pro", interval: "year", currency: "JOD" });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.url).toBe("https://tap.hpp/x");
    expect(createTapCharge).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createTapCharge).mock.calls[0][0]).toMatchObject({
      tenantId: "t1",
      plan: "pro",
      interval: "year",
      currency: "JOD"
    });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("currency USD → Stripe (the international fallback rail)", async () => {
    vi.mocked(createCheckoutSession).mockResolvedValueOnce({ id: "cs_1", url: "https://stripe/x" });
    const res = await postCheckout({ plan: "pro", interval: "year", currency: "USD" });
    expect(res.status).toBe(200);
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(createTapCharge).not.toHaveBeenCalled();
  });

  it("absent currency → Stripe (S4 backward compatibility)", async () => {
    vi.mocked(createCheckoutSession).mockResolvedValueOnce({ id: "cs_2", url: "https://stripe/y" });
    const res = await postCheckout({ plan: "starter", interval: "month" });
    expect(res.status).toBe(200);
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(createTapCharge).not.toHaveBeenCalled();
  });
});
