import { describe, it, expect, beforeEach, vi } from "vitest";

// S8 — HTTP route-handler integration tests for the three /api/founder/tenants/[id]/*
// routes (lesson L1: exercise the actual handler for every branch). The founder
// gate (getPlatformAdmin) and the mutations are mocked here; their real behaviour
// against live Supabase is covered by the L2 suite (story-8-founder-db). The point
// of THIS suite is the security branch shape: a non-admin must get 404 on every
// route, a bad id 400, and a real admin 200 with the mutation actually invoked.

const state = vi.hoisted(() => ({
  caller: null as { id: string; email: string } | null,
  pauseTenant: vi.fn(),
  unpauseTenant: vi.fn(),
  activateInvoice: vi.fn()
}));

vi.mock("@/lib/founder/guard", () => ({
  getPlatformAdmin: async () => state.caller
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ __admin: true })
}));

vi.mock("@/lib/founder/actions", () => ({
  pauseTenant: (...a: unknown[]) => state.pauseTenant(...a),
  unpauseTenant: (...a: unknown[]) => state.unpauseTenant(...a),
  activateInvoice: (...a: unknown[]) => state.activateInvoice(...a)
}));

import { POST as pausePOST } from "@/app/api/founder/tenants/[id]/pause/route";
import { POST as unpausePOST } from "@/app/api/founder/tenants/[id]/unpause/route";
import { POST as activatePOST } from "@/app/api/founder/tenants/[id]/activate/route";

const VALID_ID = "11111111-1111-1111-1111-111111111111";

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

function post(handler: Handler, id: string) {
  return handler(new Request("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ id })
  });
}

beforeEach(() => {
  state.caller = { id: "founder-1", email: "founder@lab.com" };
  state.pauseTenant.mockReset();
  state.unpauseTenant.mockReset();
  state.activateInvoice.mockReset();
});

const routes: { name: string; handler: Handler; fn: () => ReturnType<typeof vi.fn> }[] = [
  { name: "pause", handler: pausePOST, fn: () => state.pauseTenant },
  { name: "unpause", handler: unpausePOST, fn: () => state.unpauseTenant },
  { name: "activate", handler: activatePOST, fn: () => state.activateInvoice }
];

for (const { name, handler, fn } of routes) {
  describe(`POST /api/founder/tenants/[id]/${name}`, () => {
    it(`@AC-8.1 non-admin → 404, mutation NOT run`, async () => {
      state.caller = null;
      const res = await post(handler, VALID_ID);
      expect(res.status).toBe(404);
      expect(fn()).not.toHaveBeenCalled();
    });

    it(`@AC-8.6 admin + bad tenant id → 400, mutation NOT run`, async () => {
      const res = await post(handler, "not-a-uuid");
      expect(res.status).toBe(400);
      expect(fn()).not.toHaveBeenCalled();
    });

    it(`@AC-8.4 admin + valid id → 200 and runs the mutation with (admin, id)`, async () => {
      const res = await post(handler, VALID_ID);
      expect(res.status).toBe(200);
      expect(fn()).toHaveBeenCalledWith({ __admin: true }, VALID_ID);
    });
  });
}
