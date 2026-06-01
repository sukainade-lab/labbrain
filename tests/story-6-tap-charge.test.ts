import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { intervalTotal, getPlan } from "@/lib/pricing/plans";
import { createTapCharge } from "@/lib/payment/tap/checkout";

// Story 6 — Tap HPP charge (AC-6.2). createTapCharge is tested against a mocked
// fetch so no real Tap call is made; the amount MUST come from the pricing source
// of truth (plans.ts), never hardcoded. This file does not mock the tap/checkout
// module (vi.mock is module-wide) so the real implementation runs.

describe("@AC-6.2 createTapCharge opens a Tap HPP charge", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.TAP_SECRET_KEY = "sk_test_x";
    process.env.APP_URL = "https://app.labbrain.io";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.TAP_SECRET_KEY;
    delete process.env.APP_URL;
    vi.restoreAllMocks();
  });

  it("posts the JOD amount derived from plans.ts and returns the HPP URL", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "chg_1", transaction: { url: "https://tap.hpp/redirect" } })
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const out = await createTapCharge({
      tenantId: "t1",
      plan: "pro",
      interval: "year",
      currency: "JOD",
      customerEmail: "a@lab.jo"
    });

    expect(out).toEqual({ id: "chg_1", url: "https://tap.hpp/redirect" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.tap.company/v2/charges");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sk_test_x");
    const sent = JSON.parse(init.body);
    // pro/year JOD = 70 × 12 × 0.75 = 630, straight from the pricing source of truth.
    expect(sent.amount).toBe(intervalTotal(getPlan("pro"), "year"));
    expect(sent.amount).toBe(630);
    expect(sent.currency).toBe("JOD");
    expect(sent.post.url).toBe("https://app.labbrain.io/api/webhooks/tap");
    expect(sent.metadata).toMatchObject({ tenant_id: "t1", plan: "pro", interval: "year" });
  });

  it("throws when TAP_SECRET_KEY is unset (never a keyless call)", async () => {
    delete process.env.TAP_SECRET_KEY;
    await expect(
      createTapCharge({
        tenantId: "t1",
        plan: "starter",
        interval: "month",
        currency: "JOD",
        customerEmail: "a@lab.jo"
      })
    ).rejects.toThrow(/TAP_SECRET_KEY/);
  });

  it("throws on a non-2xx Tap response (no silent failed charge)", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ errors: [{ description: "bad" }] })
    })) as unknown as typeof fetch;
    await expect(
      createTapCharge({
        tenantId: "t1",
        plan: "pro",
        interval: "month",
        currency: "JOD",
        customerEmail: "a@lab.jo"
      })
    ).rejects.toThrow(/Tap API \/charges failed \(400\)/);
  });
});
