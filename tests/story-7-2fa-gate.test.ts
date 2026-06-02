import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { MFA_COOKIE_NAME, signMfaCookie } from "@/lib/auth/mfa-cookie";

// S7 AC-7.4 (lesson L4) — trace the user-reachable path end to end:
//   login → (2FA pending) → verify → dashboard, and prove the proxy gate blocks a
//   2FA-enabled user who holds only the Supabase session (no lb_mfa cookie). The
//   middleware addition is the entire security value of S7, so it gets a direct test.

const SECRET = "gate-test-secret-32-bytes-minimum-xx";

// ── shared mock state ───────────────────────────────────────────────────────────
const m = vi.hoisted(() => ({
  // login-route side
  signInUser: null as { id: string } | null,
  signInError: null as { message: string } | null,
  getUserMfa: vi.fn(),
  issueChallenge: vi.fn(),
  // proxy side
  ssrUser: null as { id: string } | null,
  ssrMe: null as { mfa_enabled: boolean } | null
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: async () => ({
        data: { user: m.signInUser },
        error: m.signInError
      })
    }
  })
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

vi.mock("@/lib/auth/mfa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/mfa")>();
  return {
    ...actual,
    getUserMfa: (...a: unknown[]) => m.getUserMfa(...a),
    issueChallenge: (...a: unknown[]) => m.issueChallenge(...a)
  };
});

// proxy.ts builds its client straight from @supabase/ssr.
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: m.ssrUser } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.ssrMe }) }) })
    })
  })
}));

import { POST as loginPOST } from "@/app/api/auth/login/route";
import { proxy } from "@/proxy";

function loginReq(body: unknown) {
  return loginPOST(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
  process.env.MFA_COOKIE_SECRET = SECRET;
  m.signInUser = null;
  m.signInError = null;
  m.getUserMfa.mockReset();
  m.issueChallenge.mockReset();
  m.ssrUser = null;
  m.ssrMe = null;
});

describe("login routes the 2FA factor (AC-7.4)", () => {
  it("@AC-7.4 a 2FA-enabled user → next=/login/verify (not /dashboard) + login OTP issued", async () => {
    m.signInUser = { id: "u-2fa" };
    m.getUserMfa.mockResolvedValue({ phone: "+962791234567", mfa_enabled: true, phone_verified_at: "x" });
    m.issueChallenge.mockResolvedValue({ ok: true, messageId: "M" });

    const res = await loginReq({ email: "a@b.co", password: "pw" });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.mfa).toBe(true);
    expect(data.next).toBe("/login/verify");
    expect(m.issueChallenge).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ purpose: "login" })
    );
  });

  it("@AC-7.4 a non-2FA user → next=/dashboard, no OTP issued", async () => {
    m.signInUser = { id: "u-plain" };
    m.getUserMfa.mockResolvedValue({ phone: null, mfa_enabled: false, phone_verified_at: null });

    const res = await loginReq({ email: "a@b.co", password: "pw" });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.next).toBe("/dashboard");
    expect(data.mfa).toBeUndefined();
    expect(m.issueChallenge).not.toHaveBeenCalled();
  });

  it("@AC-1.5 wrong password still → 401 (2FA doesn't change the password gate)", async () => {
    m.signInError = { message: "Invalid login credentials" };
    const res = await loginReq({ email: "a@b.co", password: "bad" });
    expect(res.status).toBe(401);
  });
});

describe("proxy gate enforces the second factor (AC-7.4)", () => {
  function gateReq(cookie?: { name: string; value: string }) {
    const req = new NextRequest("http://localhost/dashboard");
    if (cookie) req.cookies.set(cookie.name, cookie.value);
    return req;
  }

  it("@AC-7.4 no Supabase session → redirect to /login", async () => {
    m.ssrUser = null;
    const res = await proxy(gateReq());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("@AC-7.4 2FA user WITHOUT lb_mfa cookie → redirect to /login/verify", async () => {
    m.ssrUser = { id: "u-2fa" };
    m.ssrMe = { mfa_enabled: true };
    const res = await proxy(gateReq());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login/verify");
  });

  it("@AC-7.4 2FA user WITH a valid lb_mfa cookie → passes through", async () => {
    m.ssrUser = { id: "u-2fa" };
    m.ssrMe = { mfa_enabled: true };
    const token = signMfaCookie("u-2fa", SECRET);
    const res = await proxy(gateReq({ name: MFA_COOKIE_NAME, value: token }));
    expect(res.status).toBe(200); // NextResponse.next()
    expect(res.headers.get("location")).toBeNull();
  });

  it("@AC-7.4 2FA user with another user's cookie → redirect to /login/verify", async () => {
    m.ssrUser = { id: "u-2fa" };
    m.ssrMe = { mfa_enabled: true };
    const token = signMfaCookie("someone-else", SECRET);
    const res = await proxy(gateReq({ name: MFA_COOKIE_NAME, value: token }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login/verify");
  });

  it("@AC-7.4 a non-2FA user passes through on the Supabase session alone", async () => {
    m.ssrUser = { id: "u-plain" };
    m.ssrMe = { mfa_enabled: false };
    const res = await proxy(gateReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
