import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// S8 AC-8.4 — proxy pause enforcement. When a founder pauses a lab
// (tenants.status = 'paused'), the proxy must freeze that lab's authenticated
// users out of the entire (app) group and send them to the public
// /account-paused explainer (NOT /login — they ARE authenticated). This is the
// enforcement point that gives the founder panel's pause action its teeth.
//
// Mirrors the story-7 proxy-gate mock pattern: proxy.ts builds its client straight
// from @supabase/ssr, so we stub createServerClient and drive m.ssrUser / m.ssrMe.

const m = vi.hoisted(() => ({
  ssrUser: null as { id: string } | null,
  ssrMe: null as { mfa_enabled: boolean; tenants?: { status?: string } | null } | null
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: m.ssrUser } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.ssrMe }) }) })
    })
  })
}));

import { proxy } from "@/proxy";

function gateReq() {
  return new NextRequest("http://localhost/dashboard");
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
  m.ssrUser = null;
  m.ssrMe = null;
});

describe("proxy freezes a paused lab's users (AC-8.4)", () => {
  it("@AC-8.4 a paused tenant's authenticated user → redirect to /account-paused", async () => {
    m.ssrUser = { id: "u-paused" };
    m.ssrMe = { mfa_enabled: false, tenants: { status: "paused" } };
    const res = await proxy(gateReq());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/account-paused");
  });

  it("@AC-8.4 an active tenant's user is NOT frozen (passes through)", async () => {
    m.ssrUser = { id: "u-active" };
    m.ssrMe = { mfa_enabled: false, tenants: { status: "active" } };
    const res = await proxy(gateReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("@AC-8.4 the pause freeze takes precedence over the /login gate intent for a logged-in user", async () => {
    // A paused user holds a valid Supabase session, so they must NOT be sent to
    // /login (that's for the unauthenticated). They land on the explainer instead.
    m.ssrUser = { id: "u-paused" };
    m.ssrMe = { mfa_enabled: false, tenants: { status: "paused" } };
    const res = await proxy(gateReq());
    expect(res.headers.get("location")).not.toContain("/login");
    expect(res.headers.get("location")).toContain("/account-paused");
  });

  it("@AC-8.4 inactive/past_due are NOT treated as paused (no onboarding regression)", async () => {
    // Deliberately scoped to ONLY 'paused' so the signup → (app) onboarding flow
    // (which starts 'inactive') is not broken by this freeze.
    for (const status of ["inactive", "past_due"]) {
      m.ssrUser = { id: `u-${status}` };
      m.ssrMe = { mfa_enabled: false, tenants: { status } };
      const res = await proxy(gateReq());
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("@AC-8.4 no Supabase session still → /login (unauthenticated wins over pause check)", async () => {
    m.ssrUser = null;
    const res = await proxy(gateReq());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
