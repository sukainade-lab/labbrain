import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getDashboardStats, monthStartISO, countQueriesThisMonth } from "@/lib/dashboard/stats";

// Story 4 — dashboard usage counters (AC-4.5). Pure month-boundary math is unit
// tested; the aggregation runs LIVE against local Supabase so the counts (and
// the "this month" window) reflect real rows, not a mock's idea of them.
//   - Route seam (auth + wiring, L1) → tests/story-4-dashboard-routes.test.ts

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && serviceKey);

describe("AC-4.5 monthStartISO (pure)", () => {
  it("returns the first instant of the current UTC month", () => {
    expect(monthStartISO(new Date("2026-03-17T09:30:00Z"))).toBe("2026-03-01T00:00:00.000Z");
    expect(monthStartISO(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01T00:00:00.000Z");
    expect(monthStartISO(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-01T00:00:00.000Z");
  });
});

describe.skipIf(!hasLiveSupabase)("Story 4 — dashboard stats (live)", () => {
  let admin: SupabaseClient;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: tenant, error: tErr } = await admin
      .from("tenants")
      .insert({ name: `Dash-Lab-${Date.now()}`, plan: "pro" })
      .select()
      .single();
    if (tErr) throw tErr;
    tenantId = tenant.id;

    const email = `dash-owner-${Date.now()}-${Math.random().toString(36).slice(2)}@labbrain.test`;
    const { data: created, error: uErr } = await admin.auth.admin.createUser({
      email,
      password: "Test-Passw0rd!",
      email_confirm: true
    });
    if (uErr) throw uErr;
    userId = created.user.id;
    const { error: linkErr } = await admin
      .from("users")
      .insert({ id: userId, tenant_id: tenantId, email, role: "owner" });
    if (linkErr) throw linkErr;

    // 2 documents.
    const { error: dErr } = await admin.from("documents").insert([
      { tenant_id: tenantId, filename: "a.pdf", storage_path: `${tenantId}/a.pdf`, status: "ready" },
      { tenant_id: tenantId, filename: "b.pdf", storage_path: `${tenantId}/b.pdf`, status: "ready" }
    ]);
    if (dErr) throw dErr;

    // 3 queries this month + 1 from a previous month (must be excluded).
    // Every row carries created_at explicitly: PostgREST bulk-inserts the union
    // of keys, and a row missing a key gets NULL (not the column default) — so a
    // mixed-shape array would violate queries.created_at NOT NULL.
    const now = new Date().toISOString();
    const lastMonth = new Date(new Date(monthStartISO()).getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const { error: qErr } = await admin.from("queries").insert([
      { tenant_id: tenantId, user_id: userId, question_text: "q1", found_answer: true, created_at: now },
      { tenant_id: tenantId, user_id: userId, question_text: "q2", found_answer: true, created_at: now },
      { tenant_id: tenantId, user_id: userId, question_text: "q3", found_answer: false, created_at: now },
      { tenant_id: tenantId, user_id: userId, question_text: "old", found_answer: true, created_at: lastMonth }
    ]);
    if (qErr) throw qErr;
  });

  afterAll(async () => {
    if (admin && tenantId) await admin.from("tenants").delete().eq("id", tenantId);
  });

  it("@AC-4.5 counts documents, active users, and questions this month against plan limits", async () => {
    const stats = await getDashboardStats(admin, tenantId);
    expect(stats.plan).toBe("pro");
    expect(stats.documents).toEqual({ count: 2, limit: 200 }); // pro doc cap
    expect(stats.users).toEqual({ count: 1, limit: 20 }); // pro seat cap, owner only
    expect(stats.questionsThisMonth).toBe(3); // the older query is excluded
  });

  it("@AC-4.5 the month window excludes last month's queries", async () => {
    expect(await countQueriesThisMonth(admin, tenantId)).toBe(3);
  });
});
