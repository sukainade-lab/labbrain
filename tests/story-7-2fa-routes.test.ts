import { describe, it, expect, beforeEach, vi } from "vitest";
import { MFA_COOKIE_NAME, verifyMfaCookie } from "@/lib/auth/mfa-cookie";

// S7 — HTTP route-handler integration tests for the four /api/auth/2fa/* routes
// (lesson L1: exercise the actual handler for every branch, success + each error
// status). The DB/SMS orchestration in lib/auth/mfa is mocked here; its real
// behaviour against live Supabase is covered by the L2 suite (story-7-mfa-db).

const SECRET = "test-mfa-secret-for-routes-32bytes";

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  getUserMfa: vi.fn(),
  issueChallenge: vi.fn(),
  verifyChallenge: vi.fn()
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) }
  })
}));

// A chainable admin stub: the verify route writes users.* directly via the admin
// client (admin.from("users").update({...}).eq("id", …)).
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) })
    })
  })
}));

vi.mock("@/lib/auth/mfa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/mfa")>();
  return {
    ...actual, // keep verifyErrorMessage + mfaSecret real
    getUserMfa: (...a: unknown[]) => state.getUserMfa(...a),
    issueChallenge: (...a: unknown[]) => state.issueChallenge(...a),
    verifyChallenge: (...a: unknown[]) => state.verifyChallenge(...a)
  };
});

import { POST as enrollPOST } from "@/app/api/auth/2fa/enroll/route";
import { POST as sendPOST } from "@/app/api/auth/2fa/send/route";
import { POST as verifyPOST } from "@/app/api/auth/2fa/verify/route";
import { POST as disablePOST } from "@/app/api/auth/2fa/disable/route";

function postJson<T extends Response>(handler: (req: Request) => Promise<T>, body?: unknown) {
  return handler(
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  );
}

beforeEach(() => {
  process.env.MFA_COOKIE_SECRET = SECRET;
  state.user = { id: "user-1" };
  state.getUserMfa.mockReset();
  state.issueChallenge.mockReset();
  state.verifyChallenge.mockReset();
});

// ── /api/auth/2fa/enroll ────────────────────────────────────────────────────────
describe("POST /api/auth/2fa/enroll", () => {
  it("@AC-7.1 malformed body → 400", async () => {
    const res = await postJson(enrollPOST, {});
    expect(res.status).toBe(400);
  });

  it("@AC-7.1 unauthenticated → 401", async () => {
    state.user = null;
    const res = await postJson(enrollPOST, { phone: "0791234567" });
    expect(res.status).toBe(401);
  });

  it("@AC-7.1 invalid Jordan number → 400", async () => {
    const res = await postJson(enrollPOST, { phone: "0601234567" });
    expect(res.status).toBe(400);
  });

  it("@AC-7.5 rate-limited issue → 429", async () => {
    state.issueChallenge.mockResolvedValue({ ok: false, reason: "rate_limited", retryAfterMs: 1000 });
    const res = await postJson(enrollPOST, { phone: "0791234567" });
    expect(res.status).toBe(429);
  });

  it("@AC-7.1 valid number → 200 and issues an enroll OTP", async () => {
    state.issueChallenge.mockResolvedValue({ ok: true, messageId: "M1" });
    const res = await postJson(enrollPOST, { phone: "0791234567" });
    expect(res.status).toBe(200);
    expect(state.issueChallenge).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recipient: "962791234567", purpose: "enroll" })
    );
  });
});

// ── /api/auth/2fa/send ──────────────────────────────────────────────────────────
describe("POST /api/auth/2fa/send", () => {
  it("@AC-7.2 unauthenticated → 401", async () => {
    state.user = null;
    const res = await postJson(sendPOST, { purpose: "login" });
    expect(res.status).toBe(401);
  });

  it("@AC-7.2 no registered phone → 400", async () => {
    state.getUserMfa.mockResolvedValue({ phone: null, mfa_enabled: false, phone_verified_at: null });
    const res = await postJson(sendPOST, { purpose: "login" });
    expect(res.status).toBe(400);
  });

  it("@AC-7.5 cooldown → 429", async () => {
    state.getUserMfa.mockResolvedValue({ phone: "+962791234567", mfa_enabled: true, phone_verified_at: "x" });
    state.issueChallenge.mockResolvedValue({ ok: false, reason: "cooldown", retryAfterMs: 5000 });
    const res = await postJson(sendPOST, { purpose: "login" });
    expect(res.status).toBe(429);
  });

  it("@AC-7.2 registered phone → 200", async () => {
    state.getUserMfa.mockResolvedValue({ phone: "+962791234567", mfa_enabled: true, phone_verified_at: "x" });
    state.issueChallenge.mockResolvedValue({ ok: true, messageId: "M2" });
    const res = await postJson(sendPOST, { purpose: "login" });
    expect(res.status).toBe(200);
  });
});

// ── /api/auth/2fa/verify ────────────────────────────────────────────────────────
describe("POST /api/auth/2fa/verify", () => {
  it("@AC-7.3 malformed code → 400", async () => {
    const res = await postJson(verifyPOST, { code: "12", purpose: "login" });
    expect(res.status).toBe(400);
  });

  it("@AC-7.3 unauthenticated → 401", async () => {
    state.user = null;
    const res = await postJson(verifyPOST, { code: "123456", purpose: "login" });
    expect(res.status).toBe(401);
  });

  it("@AC-7.3 wrong code → 401, no elevation cookie", async () => {
    state.verifyChallenge.mockResolvedValue("wrong");
    const res = await postJson(verifyPOST, { code: "000000", purpose: "login" });
    expect(res.status).toBe(401);
    expect(res.cookies.get(MFA_COOKIE_NAME)?.value).toBeFalsy();
  });

  it("@AC-7.3 correct login code → 200 + valid lb_mfa cookie + dashboard", async () => {
    state.verifyChallenge.mockResolvedValue("ok");
    const res = await postJson(verifyPOST, { code: "123456", purpose: "login" });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.next).toBe("/dashboard");
    const token = res.cookies.get(MFA_COOKIE_NAME)?.value ?? "";
    expect(verifyMfaCookie(token, SECRET)).toEqual({ userId: "user-1" });
  });

  it("@AC-7.1 correct enroll code → 200 + elevation cookie (enables 2FA)", async () => {
    state.verifyChallenge.mockResolvedValue("ok");
    const res = await postJson(verifyPOST, { code: "123456", purpose: "enroll" });
    expect(res.status).toBe(200);
    const token = res.cookies.get(MFA_COOKIE_NAME)?.value ?? "";
    expect(verifyMfaCookie(token, SECRET)).toEqual({ userId: "user-1" });
  });

  it("@AC-7.6 correct disable code → 200 + cookie cleared", async () => {
    state.verifyChallenge.mockResolvedValue("ok");
    const res = await postJson(verifyPOST, { code: "123456", purpose: "disable" });
    expect(res.status).toBe(200);
    const cookie = res.cookies.get(MFA_COOKIE_NAME);
    expect(cookie?.value).toBe("");
    expect(cookie?.maxAge).toBe(0);
  });
});

// ── /api/auth/2fa/disable ───────────────────────────────────────────────────────
describe("POST /api/auth/2fa/disable", () => {
  it("@AC-7.6 unauthenticated → 401", async () => {
    state.user = null;
    const res = await postJson(disablePOST);
    expect(res.status).toBe(401);
  });

  it("@AC-7.6 2FA not enabled → 400", async () => {
    state.getUserMfa.mockResolvedValue({ phone: "+962791234567", mfa_enabled: false, phone_verified_at: null });
    const res = await postJson(disablePOST);
    expect(res.status).toBe(400);
  });

  it("@AC-7.6 enabled → 200 issues a disable OTP", async () => {
    state.getUserMfa.mockResolvedValue({ phone: "+962791234567", mfa_enabled: true, phone_verified_at: "x" });
    state.issueChallenge.mockResolvedValue({ ok: true, messageId: "M3" });
    const res = await postJson(disablePOST);
    expect(res.status).toBe(200);
    expect(state.issueChallenge).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ purpose: "disable" })
    );
  });
});
