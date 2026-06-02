import { describe, it, expect, vi } from "vitest";
import { startCheckout } from "@/lib/payment/checkout-client";
import { DEFAULT_CURRENCY } from "@/lib/pricing/currency";

// Story 6 — pricing CTA reaches the right rail end-to-end (AC-6.6 / L4). The page
// passes the user-facing currency (JOD default); startCheckout must forward it in
// the POST body so the server router (pickProvider) sends JOD to Tap and returns
// the Tap HPP URL the browser then redirects to. Omitting currency keeps the S4
// Stripe contract (covered in story-4-checkout-client).

function res(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  } as unknown as Response;
}

describe("@AC-6.6 startCheckout carries the currency to the rail", () => {
  it("forwards JOD in the body and redirects to the Tap HPP URL", async () => {
    const fetchFn = vi.fn(async () => res(200, { url: "https://tap.hpp/redirect" }));
    const redirect = vi.fn();
    const onError = vi.fn();

    await startCheckout("pro", "year", { fetchFn, redirect, onError }, DEFAULT_CURRENCY);

    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody).toEqual({ plan: "pro", interval: "year", currency: "JOD" });
    expect(redirect).toHaveBeenCalledWith("https://tap.hpp/redirect");
    expect(onError).not.toHaveBeenCalled();
  });

  it("omitting currency keeps the S4 body shape (Stripe rail untouched)", async () => {
    const fetchFn = vi.fn(async () => res(200, { url: "https://checkout.stripe/x" }));
    await startCheckout("starter", "month", { fetchFn, redirect: vi.fn(), onError: vi.fn() });
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody).toEqual({ plan: "starter", interval: "month" });
  });
});
