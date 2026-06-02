import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Story 6 — Tap webhook HTTP seam (AC-6.3, Lesson L1). Verifies the signature
// gate and dispatch to the shared reducer. verifyWebhook + applyOutcome are
// mocked here; real signature math is in story-6-tap-webhook, real DB activation
// is live in story-6-tap-activation.

const h = vi.hoisted(() => ({
  verify: vi.fn(),
  apply: vi.fn()
}));

vi.mock("@/lib/payment/tap/provider", () => ({
  tapProvider: { name: "tap", verifyWebhook: h.verify }
}));
vi.mock("@/lib/payment/activation-core", () => ({ applyOutcome: h.apply }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { POST as tapWebhookPOST } from "@/app/api/webhooks/tap/route";

function call(body = "{}") {
  return tapWebhookPOST(
    new NextRequest("http://localhost/api/webhooks/tap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
    })
  );
}

describe("Story 6 — /api/webhooks/tap route handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("@AC-6.3 invalid signature (verify → null) → 400, never applies", async () => {
    h.verify.mockResolvedValueOnce(null);
    const res = await call();
    expect(res.status).toBe(400);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("@AC-6.3 a verified outcome → 200 and is applied once", async () => {
    const outcome = { kind: "activate", tenantId: "t1", plan: "pro", record: null };
    h.verify.mockResolvedValueOnce(outcome);
    h.apply.mockResolvedValueOnce(undefined);
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.apply).toHaveBeenCalledTimes(1);
    expect(h.apply.mock.calls[0][1]).toBe(outcome);
  });

  it("@AC-6.3 an ignore outcome still → 200 (acknowledged, nothing activated)", async () => {
    h.verify.mockResolvedValueOnce({ kind: "ignore" });
    h.apply.mockResolvedValueOnce(undefined);
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.apply).toHaveBeenCalledTimes(1);
  });

  it("@AC-6.3 a handler failure → 500 (so Tap retries the idempotent reducer)", async () => {
    h.verify.mockResolvedValueOnce({ kind: "activate", tenantId: "t1", plan: null, record: null });
    h.apply.mockRejectedValueOnce(new Error("db down"));
    const res = await call();
    expect(res.status).toBe(500);
  });
});
