import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// S8 — live DB suite for the founder panel (lesson L2: serialized + unique-tenant
// scoped, cleans up in afterAll; CI runs the live job with --no-file-parallelism
// --retry=2). Exercises the real founder_tenant_overview RPC (cross-tenant
// aggregation), the pause/unpause status flips, and idempotent manual activation
// against Supabase. The activation email seam is mocked so no real email is sent.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && anonKey && serviceKey);

vi.mock("@/lib/email/resend", () => ({
  sendActivationEmail: vi.fn(async () => ({ id: "TEST" }))
}));

import { getTenantOverview } from "@/lib/founder/stats";
import { pauseTenant, unpauseTenant, activateInvoice } from "@/lib/founder/actions";

const PASSWORD = "Test-Passw0rd!";
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const uniq = (p: string) => `${p}-${stamp}@labbrain.test`;

describe.skipIf(!hasLiveSupabase).sequential("Story 8 — founder panel (live DB)", () => {
  let admin: SupabaseClient;
  let tenantActive: string; // becomes active via manual activation
  let tenantPending: string; // stays inactive (pending invoice)
  let ownerActiveId: string;
  let ownerPendingId: string;
  const ownerActiveEmail = uniq("owner-active");
  const ownerPendingEmail = uniq("owner-pending");

  async function seedTenant(name: string, status: string) {
    const { data } = await admin
      .from("tenants")
      .insert({ name: `${name} ${stamp}`, plan: "pro", status })
      .select("id")
      .single();
    return data!.id as string;
  }

  async function seedOwner(tenantId: string, email: string) {
    const { data } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true
    });
    const id = data!.user!.id;
    await admin.from("users").insert({ id, tenant_id: tenantId, email, role: "owner" });
    return id;
  }

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    tenantActive = await seedTenant("Active Lab", "inactive");
    tenantPending = await seedTenant("Pending Lab", "inactive");
    ownerActiveId = await seedOwner(tenantActive, ownerActiveEmail);
    ownerPendingId = await seedOwner(tenantPending, ownerPendingEmail);

    // Usage on the active lab: 2 documents, 3 questions this month.
    await admin.from("documents").insert([
      { tenant_id: tenantActive, filename: "iso.pdf", storage_path: `${tenantActive}/a` },
      { tenant_id: tenantActive, filename: "sop.pdf", storage_path: `${tenantActive}/b` }
    ]);
    await admin.from("queries").insert([
      { tenant_id: tenantActive, question_text: "q1" },
      { tenant_id: tenantActive, question_text: "q2" },
      { tenant_id: tenantActive, question_text: "q3" }
    ]);
    await admin.from("queries").insert([{ tenant_id: tenantPending, question_text: "q1" }]);
  });

  afterAll(async () => {
    if (!admin) return;
    for (const t of [tenantActive, tenantPending]) {
      await admin.from("subscriptions").delete().eq("tenant_id", t);
      await admin.from("queries").delete().eq("tenant_id", t);
      await admin.from("documents").delete().eq("tenant_id", t);
      await admin.from("tenants").delete().eq("id", t);
    }
    for (const u of [ownerActiveId, ownerPendingId]) {
      try {
        await admin.auth.admin.deleteUser(u);
      } catch {
        /* best-effort */
      }
    }
  });

  it("@AC-8.3 founder_tenant_overview aggregates per-tenant usage cross-tenant", async () => {
    const rows = await getTenantOverview(admin);
    const a = rows.find((r) => r.tenant_id === tenantActive);
    const p = rows.find((r) => r.tenant_id === tenantPending);

    expect(a).toBeTruthy();
    expect(a!.owner_email).toBe(ownerActiveEmail);
    expect(Number(a!.user_count)).toBe(1);
    expect(Number(a!.doc_count)).toBe(2);
    expect(Number(a!.questions_this_month)).toBe(3);

    expect(p).toBeTruthy();
    expect(Number(p!.doc_count)).toBe(0);
    expect(Number(p!.questions_this_month)).toBe(1);
  });

  it("@AC-8.1 the RPC is NOT executable by an anon client (service-role only)", async () => {
    const anon = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data, error } = await anon.rpc("founder_tenant_overview");
    expect(error).toBeTruthy(); // execute granted to service_role only
    expect(data ?? null).toBeNull();
  });

  it("@AC-8.4 pause → tenants.status 'paused', unpause → 'active'", async () => {
    await pauseTenant(admin, tenantPending);
    let { data } = await admin.from("tenants").select("status").eq("id", tenantPending).single();
    expect(data!.status).toBe("paused");

    await unpauseTenant(admin, tenantPending);
    ({ data } = await admin.from("tenants").select("status").eq("id", tenantPending).single());
    expect(data!.status).toBe("active");
  });

  it("@AC-8.5 mark invoice paid activates the tenant + records a 'manual' subscription, idempotently", async () => {
    await activateInvoice(admin, tenantActive);

    const { data: tenant } = await admin
      .from("tenants")
      .select("status")
      .eq("id", tenantActive)
      .single();
    expect(tenant!.status).toBe("active");

    const { data: subs1 } = await admin
      .from("subscriptions")
      .select("id, provider, provider_subscription_id, currency, status")
      .eq("tenant_id", tenantActive);
    expect(subs1).toHaveLength(1);
    expect(subs1![0].provider).toBe("manual");
    expect(subs1![0].provider_subscription_id).toBe(`manual:${tenantActive}`);
    expect(subs1![0].currency).toBe("JOD");

    // Re-marking paid must update the same row, not duplicate it (idempotent).
    await activateInvoice(admin, tenantActive);
    const { data: subs2 } = await admin
      .from("subscriptions")
      .select("id")
      .eq("tenant_id", tenantActive);
    expect(subs2).toHaveLength(1);
  });
});
