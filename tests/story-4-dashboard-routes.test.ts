import { describe, it, expect, beforeEach, vi } from "vitest";

// Story 4 — dashboard counters HTTP seam (AC-4.5, Lesson L1). Auth gate + the
// tenant→stats wiring. getDashboardStats is mocked here; its real counting is
// covered live in tests/story-4-dashboard.test.ts.

const h = vi.hoisted(() => ({
  state: { user: null as { id: string } | null, me: null as { tenant_id: string } | null },
  getStats: vi.fn()
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.state.user } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: h.state.me }) }) }) })
  })
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/dashboard/stats", () => ({ getDashboardStats: h.getStats }));

import { GET as dashboardGET } from "@/app/api/dashboard/route";

describe("Story 4 — /api/dashboard route handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.user = null;
    h.state.me = null;
  });

  it("@AC-4.5 unauthenticated → 401, never queries stats", async () => {
    const res = await dashboardGET();
    expect(res.status).toBe(401);
    expect(h.getStats).not.toHaveBeenCalled();
  });

  it("@AC-4.5 authed → 200 with the three counters, scoped to the tenant", async () => {
    h.state.user = { id: "u1" };
    h.state.me = { tenant_id: "t1" };
    const stats = {
      plan: "pro",
      documents: { count: 12, limit: 200 },
      users: { count: 4, limit: 20 },
      questionsThisMonth: 37
    };
    h.getStats.mockResolvedValueOnce(stats);

    const res = await dashboardGET();
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toMatchObject(stats);
    expect(h.getStats).toHaveBeenCalledTimes(1);
    expect(h.getStats.mock.calls[0][1]).toBe("t1");
  });

  it("@AC-4.5 a stats failure → 500", async () => {
    h.state.user = { id: "u1" };
    h.state.me = { tenant_id: "t1" };
    h.getStats.mockRejectedValueOnce(new Error("db down"));
    const res = await dashboardGET();
    expect(res.status).toBe(500);
  });
});
