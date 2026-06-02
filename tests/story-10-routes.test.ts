import { describe, it, expect, beforeEach, vi } from "vitest";
import { MigrationError } from "@/lib/migration/run";

// S10 — HTTP route-handler integration tests for the founder migration routes
// (lesson L1: exercise the real handler for every branch). The gate, the admin
// client, the KSA target, and the orchestrator are mocked here; their real
// behaviour against live Supabase is the L2 suite. THIS suite proves the security
// + error branch shape: non-admin → 404, bad id → 400, success → 200, verify
// mismatch → 422, already-cut-over → 409.

const state = vi.hoisted(() => ({
  caller: null as { id: string; email: string } | null,
  runMigration: vi.fn(),
  cutoverMigration: vi.fn(),
  getStatus: vi.fn()
}));

vi.mock("@/lib/founder/guard", () => ({
  getPlatformAdmin: async () => state.caller
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ __admin: true })
}));

vi.mock("@/lib/migration/target", () => ({
  createKsaTarget: () => ({ __ksa: true })
}));

// Keep MigrationError + createSourceReader/createSupabaseStore real; mock only the
// two orchestrator fns. createSupabaseStore is replaced so handleStatus is steerable.
vi.mock("@/lib/migration/run", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/migration/run")>();
  return {
    ...actual,
    runMigration: (...a: unknown[]) => state.runMigration(...a),
    cutoverMigration: (...a: unknown[]) => state.cutoverMigration(...a),
    createSourceReader: () => ({ __reader: true }),
    createSupabaseStore: () => ({ get: (...a: unknown[]) => state.getStatus(...a) })
  };
});

import { POST as migratePOST, GET as statusGET } from "@/app/api/founder/tenants/[id]/migrate/route";
import { POST as cutoverPOST } from "@/app/api/founder/tenants/[id]/migrate/cutover/route";

const VALID_ID = "11111111-1111-1111-1111-111111111111";

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

function call(handler: Handler, id: string, method = "POST") {
  return handler(new Request("http://localhost/x", { method }), {
    params: Promise.resolve({ id })
  });
}

beforeEach(() => {
  state.caller = { id: "founder-1", email: "founder@lab.com" };
  state.runMigration.mockReset();
  state.cutoverMigration.mockReset();
  state.getStatus.mockReset();
});

describe("POST /api/founder/tenants/[id]/migrate", () => {
  it("@AC-10.1 non-admin → 404, orchestrator NOT run", async () => {
    state.caller = null;
    const res = await call(migratePOST, VALID_ID);
    expect(res.status).toBe(404);
    expect(state.runMigration).not.toHaveBeenCalled();
  });

  it("@AC-10.1 admin + bad uuid → 400, orchestrator NOT run", async () => {
    const res = await call(migratePOST, "not-a-uuid");
    expect(res.status).toBe(400);
    expect(state.runMigration).not.toHaveBeenCalled();
  });

  it("@AC-10.4 admin + valid → 200, runs with (deps, {tenantId, startedBy})", async () => {
    state.runMigration.mockResolvedValue({ status: "verified", tenantId: VALID_ID });
    const res = await call(migratePOST, VALID_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.migration.status).toBe("verified");
    expect(state.runMigration).toHaveBeenCalledTimes(1);
    const [, opts] = state.runMigration.mock.calls[0];
    expect(opts).toEqual({ tenantId: VALID_ID, startedBy: "founder@lab.com" });
  });

  it("@AC-10.4 parity mismatch (verify_failed) → 422 with diff", async () => {
    state.runMigration.mockRejectedValue(
      new MigrationError("verify_failed", "parity check failed", ["queries: source 5 ≠ target 4"])
    );
    const res = await call(migratePOST, VALID_ID);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.diff[0]).toContain("queries");
  });

  it("@AC-10.6 already cut over → 409", async () => {
    state.runMigration.mockRejectedValue(new MigrationError("already_cutover", "already migrated"));
    const res = await call(migratePOST, VALID_ID);
    expect(res.status).toBe(409);
  });

  it("unexpected error → 500", async () => {
    state.runMigration.mockRejectedValue(new Error("boom"));
    const res = await call(migratePOST, VALID_ID);
    expect(res.status).toBe(500);
  });
});

describe("POST /api/founder/tenants/[id]/migrate/cutover", () => {
  it("@AC-10.1 non-admin → 404", async () => {
    state.caller = null;
    const res = await call(cutoverPOST, VALID_ID);
    expect(res.status).toBe(404);
    expect(state.cutoverMigration).not.toHaveBeenCalled();
  });

  it("@AC-10.5 verified → 200, status cutover", async () => {
    state.cutoverMigration.mockResolvedValue({ status: "cutover", tenantId: VALID_ID });
    const res = await call(cutoverPOST, VALID_ID);
    expect(res.status).toBe(200);
    expect((await res.json()).migration.status).toBe("cutover");
  });

  it("@AC-10.5 not verified → 409", async () => {
    state.cutoverMigration.mockRejectedValue(
      new MigrationError("not_verified", "must verify first")
    );
    const res = await call(cutoverPOST, VALID_ID);
    expect(res.status).toBe(409);
  });
});

describe("GET /api/founder/tenants/[id]/migrate (status)", () => {
  it("@AC-10.1 non-admin → 404", async () => {
    state.caller = null;
    const res = await call(statusGET, VALID_ID, "GET");
    expect(res.status).toBe(404);
  });

  it("@AC-10.1 admin → 200 with the current migration record (or null)", async () => {
    state.getStatus.mockResolvedValue({ status: "verified", tenantId: VALID_ID });
    const res = await call(statusGET, VALID_ID, "GET");
    expect(res.status).toBe(200);
    expect((await res.json()).migration.status).toBe("verified");
  });
});
