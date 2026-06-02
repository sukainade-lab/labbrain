import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSourceReader } from "@/lib/migration/run";
import { buildBundle } from "@/lib/migration/bundle";

// S10 — LIVE migration suite. Two real guarantees against the local Supabase that
// can't be faked (Lesson L2 — serialized, unique-tenant, cross-tenant exclusion):
//   1. The export bundle (AC-10.2) pulls ONLY the target tenant's rows, across
//      every tenant-scoped table — Lab A's bundle never contains a Lab B row.
//   2. tenant_migrations RLS (AC-10.6) isolates the run log: a signed-in lab sees
//      only its own migration record, never another tenant's.
// Pure builder math lives in story-10-bundle/verify-state; the HTTP seam (L1) in
// story-10-routes; the panel decision table in story-10-view.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && anonKey && serviceKey);

const PASSWORD = "Test-Passw0rd!";
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe.skipIf(!hasLiveSupabase).sequential("Story 10 — migration (live)", () => {
  let admin: SupabaseClient;
  let labA: string;
  let labB: string;
  let userA: string;
  let emailA: string;
  let clientA: SupabaseClient; // signed in as Lab A → RLS active

  async function seedLab(name: string): Promise<{ tenantId: string; userId: string; email: string }> {
    const { data: tenant, error: tErr } = await admin
      .from("tenants")
      .insert({ name })
      .select()
      .single();
    if (tErr) throw tErr;
    const tenantId = tenant.id as string;

    const email = `mig-${name.toLowerCase()}-${uniq()}@labbrain.test`;
    const { data: created, error: uErr } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true
    });
    if (uErr) throw uErr;
    const userId = created.user.id;

    const { error: linkErr } = await admin
      .from("users")
      .insert({ id: userId, tenant_id: tenantId, email, role: "owner" });
    if (linkErr) throw linkErr;

    const { data: doc, error: dErr } = await admin
      .from("documents")
      .insert({ tenant_id: tenantId, filename: `${name}-SOP.pdf`, storage_path: `${tenantId}/sop.pdf`, status: "ready" })
      .select()
      .single();
    if (dErr) throw dErr;

    const { error: cErr } = await admin.from("document_chunks").insert({
      tenant_id: tenantId,
      document_id: doc.id,
      chunk_index: 0,
      content: `${name} clause 5.3 content`,
      page_number: 3
    });
    if (cErr) throw cErr;

    const { error: qErr } = await admin.from("queries").insert({
      tenant_id: tenantId,
      user_id: userId,
      question_text: `سؤال ${name}`,
      answer_text: `جواب ${name}`,
      question_lang: "ar",
      found_answer: true,
      citations: []
    });
    if (qErr) throw qErr;

    return { tenantId, userId, email };
  }

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const a = await seedLab("MigLabA");
    labA = a.tenantId;
    userA = a.userId;
    emailA = a.email;

    const b = await seedLab("MigLabB");
    labB = b.tenantId;

    clientA = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { error: siErr } = await clientA.auth.signInWithPassword({ email: emailA, password: PASSWORD });
    if (siErr) throw siErr;
  });

  afterAll(async () => {
    if (admin && labA) await admin.from("tenants").delete().eq("id", labA);
    if (admin && labB) await admin.from("tenants").delete().eq("id", labB);
  });

  it("@AC-10.2 export bundle pulls every Lab A table, counts > 0 for seeded tables", async () => {
    const bundle = await buildBundle(createSourceReader(admin), labA);
    expect(bundle.tenantId).toBe(labA);
    expect(bundle.rowCounts.tenants).toBe(1);
    expect(bundle.rowCounts.users).toBeGreaterThanOrEqual(1);
    expect(bundle.rowCounts.documents).toBeGreaterThanOrEqual(1);
    expect(bundle.rowCounts.document_chunks).toBeGreaterThanOrEqual(1);
    expect(bundle.rowCounts.queries).toBeGreaterThanOrEqual(1);
    expect(bundle.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("@AC-10.6 (P0) Lab A's bundle never contains a Lab B row, in ANY table", async () => {
    const bundle = await buildBundle(createSourceReader(admin), labA);

    // The tenants table holds exactly Lab A (scoped by id).
    expect(bundle.tables.tenants.map((r) => r.id)).toEqual([labA]);

    // Every child row is tenant-scoped to Lab A — zero leakage of Lab B's tenant_id.
    for (const table of ["users", "documents", "document_chunks", "queries"] as const) {
      const foreign = bundle.tables[table].filter((r) => r.tenant_id === labB);
      expect(foreign).toHaveLength(0);
    }

    // And Lab B's question text is absent from Lab A's export.
    const aQuestions = bundle.tables.queries.map((r) => String(r.question_text));
    expect(aQuestions.some((q) => q.includes("MigLabB"))).toBe(false);
  });

  it("@AC-10.6 tenant_migrations RLS: a signed-in lab sees only its own run log", async () => {
    // Admin (service-role) writes a run row for BOTH labs.
    const { error: insErr } = await admin.from("tenant_migrations").insert([
      { tenant_id: labA, started_by: emailA, status: "verified" },
      { tenant_id: labB, started_by: "founder@labbrain.test", status: "verified" }
    ]);
    if (insErr) throw insErr;

    // Lab A's user-scoped client must read ONLY Lab A's row.
    const { data, error } = await clientA.from("tenant_migrations").select("*");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].tenant_id).toBe(labA);
  });
});
