import { describe, it, expect, vi } from "vitest";
import { startCheckout } from "@/lib/payment/checkout-client";

// Story 4 — AC-4.2 checkout CTA wiring. The /5-eo-score caught that the pricing
// CTA never reached /api/checkout (a dead-end loop back to /signup). This pins
// the decision logic the page now drives: 200→Stripe, 401→signup, else→error.

function res(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  } as unknown as Response;
}

describe("@AC-4.2 startCheckout (CTA wiring)", () => {
  it("200 { url } → redirects the browser to Stripe Checkout", async () => {
    const fetchFn = vi.fn(async () => res(200, { url: "https://checkout.stripe/x" }));
    const redirect = vi.fn();
    const onError = vi.fn();

    await startCheckout("pro", "year", { fetchFn, redirect, onError });

    expect(fetchFn).toHaveBeenCalledWith(
      "/api/checkout",
      expect.objectContaining({ method: "POST" })
    );
    // the body carries the selected plan + interval
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody).toEqual({ plan: "pro", interval: "year" });
    expect(redirect).toHaveBeenCalledWith("https://checkout.stripe/x");
    expect(onError).not.toHaveBeenCalled();
  });

  it("401 (not signed in) → redirects to /signup carrying plan+interval", async () => {
    const fetchFn = vi.fn(async () => res(401, { error: "غير مصرّح" }));
    const redirect = vi.fn();
    const onError = vi.fn();

    await startCheckout("starter", "month", { fetchFn, redirect, onError });

    expect(redirect).toHaveBeenCalledWith("/signup?plan=starter&interval=month");
    expect(onError).not.toHaveBeenCalled();
  });

  it("non-ok (e.g. 500) → surfaces an error, never a silent no-op", async () => {
    const fetchFn = vi.fn(async () => res(500, { error: "تعذّر بدء عملية الدفع" }));
    const redirect = vi.fn();
    const onError = vi.fn();

    await startCheckout("pro", "month", { fetchFn, redirect, onError });

    expect(redirect).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("network throw → surfaces a connection error", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    });
    const redirect = vi.fn();
    const onError = vi.fn();

    await startCheckout("starter", "year", { fetchFn, redirect, onError });

    expect(redirect).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("200 but missing url → treated as an error (no dead redirect)", async () => {
    const fetchFn = vi.fn(async () => res(200, {}));
    const redirect = vi.fn();
    const onError = vi.fn();

    await startCheckout("pro", "month", { fetchFn, redirect, onError });

    expect(redirect).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
