import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAuditLog } from "@/lib/audit/export-query";

// Story 9 — LIVE audit-log query. Runs end-to-end against the real local
// Supabase: getAuditLog reads through the user-scoped (RLS) client, so tenant
// isolation is a real guarantee, never faked (AC-9.1). Pure builders are tested
// in story-9-report-html / story-9-audit-validation; the HTTP seam (L1) in
// story-9-audit-routes. Serialized + unique-tenant per Lesson L2.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && anonKey && serviceKey);

const PASSWORD = "Test-Passw0rd!";

function citation(name: string, page: number) {
  return [
    { document_id: "d1", document_name: name, section: "5.3", page_number: page, similarity: 0.9 }
  ];
}

describe.skipIf(!hasLiveSupabase)("Story 9 — audit log query (live)", () => {
  let admin: SupabaseClient;
  let client: SupabaseClient; // signed in as Lab A
  let tenantId: string;
  let userId: string;
  let ownerEmail: string;
  let otherTenantId: string; // Lab B — adversary

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // ── Lab A ────────────────────────────────────────────────────────────────
    const { data: tenant, error: tErr } = await admin
      .from("tenants")
      .insert({ name: "Audit-Lab-A" })
      .select()
      .single();
    if (tErr) throw tErr;
    tenantId = tenant.id;

    ownerEmail = `audit-owner-${Date.now()}-${Math.random().toString(36).slice(2)}@labbrain.test`;
    const { data: created, error: uErr } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: PASSWORD,
      email_confirm: true
    });
    if (uErr) throw uErr;
    userId = created.user.id;

    const { error: linkErr } = await admin
      .from("users")
      .insert({ id: userId, tenant_id: tenantId, email: ownerEmail, role: "owner" });
    if (linkErr) throw linkErr;

    // Three Q&A rows at distinct dates — inserted out of order to prove the query
    // (not the seed) imposes chronological order.
    const { error: seedErr } = await admin.from("queries").insert([
      {
        tenant_id: tenantId,
        user_id: userId,
        question_text: "سؤال مارس",
        answer_text: "جواب مارس",
        question_lang: "ar",
        found_answer: true,
        citations: citation("SOP-March.pdf", 3),
        created_at: "2026-03-15T08:00:00Z"
      },
      {
        tenant_id: tenantId,
        user_id: userId,
        question_text: "January question",
        answer_text: "January answer",
        question_lang: "en",
        found_answer: true,
        citations: citation("SOP-Jan.pdf", 1),
        created_at: "2026-01-10T08:00:00Z"
      },
      {
        tenant_id: tenantId,
        user_id: userId,
        question_text: "سؤال فبراير",
        answer_text: "",
        question_lang: "ar",
        found_answer: false,
        citations: [],
        created_at: "2026-02-20T08:00:00Z"
      }
    ]);
    if (seedErr) throw seedErr;

    // ── Lab B (adversary) ──────────────────────────────────────────────────────
    const { data: otherTenant, error: otErr } = await admin
      .from("tenants")
      .insert({ name: "Audit-Lab-B" })
      .select()
      .single();
    if (otErr) throw otErr;
    otherTenantId = otherTenant.id;

    const otherEmail = `audit-owner-b-${Date.now()}-${Math.random().toString(36).slice(2)}@labbrain.test`;
    const { data: otherCreated, error: ouErr } = await admin.auth.admin.createUser({
      email: otherEmail,
      password: PASSWORD,
      email_confirm: true
    });
    if (ouErr) throw ouErr;

    const { error: olErr } = await admin
      .from("users")
      .insert({ id: otherCreated.user.id, tenant_id: otherTenantId, email: otherEmail, role: "owner" });
    if (olErr) throw olErr;

    const { error: obErr } = await admin.from("queries").insert({
      tenant_id: otherTenantId,
      user_id: otherCreated.user.id,
      question_text: "سر المختبر ب",
      answer_text: "جواب سري",
      question_lang: "ar",
      found_answer: true,
      citations: citation("SECRET-B.pdf", 9),
      created_at: "2026-02-15T08:00:00Z"
    });
    if (obErr) throw obErr;

    // Sign in as Lab A (user-scoped client → RLS active).
    client = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { error: siErr } = await client.auth.signInWithPassword({
      email: ownerEmail,
      password: PASSWORD
    });
    if (siErr) throw siErr;
  });

  afterAll(async () => {
    if (admin && tenantId) await admin.from("tenants").delete().eq("id", tenantId);
    if (admin && otherTenantId) await admin.from("tenants").delete().eq("id", otherTenantId);
  });

  it("@AC-9.2 returns every Lab A row, chronological ascending, with asker email", async () => {
    const rows = await getAuditLog(client, { from: null, to: null });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.question_text)).toEqual([
      "January question",
      "سؤال فبراير",
      "سؤال مارس"
    ]);
    expect(rows.every((r) => r.asker_email === ownerEmail)).toBe(true);
    // citations + found flag survive the round-trip
    expect(rows[0].found_answer).toBe(true);
    expect(rows[0].citations[0]).toMatchObject({ document_name: "SOP-Jan.pdf", page_number: 1 });
    expect(rows[1].found_answer).toBe(false);
    expect(rows[1].citations).toEqual([]);
  });

  it("@AC-9.3 inclusive date range narrows to the rows inside it", async () => {
    const rows = await getAuditLog(client, { from: "2026-02-01", to: "2026-02-28" });
    expect(rows).toHaveLength(1);
    expect(rows[0].question_text).toBe("سؤال فبراير");
  });

  it("@AC-9.3 from-only is open-ended toward the present", async () => {
    const rows = await getAuditLog(client, { from: "2026-02-01", to: null });
    expect(rows.map((r) => r.question_text)).toEqual(["سؤال فبراير", "سؤال مارس"]);
  });

  it("@AC-9.1 (P0) Lab A's export never contains Lab B's rows", async () => {
    const rows = await getAuditLog(client, { from: null, to: null });
    expect(rows.some((r) => r.question_text.includes("سر المختبر ب"))).toBe(false);
  });
});
