import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Story 2 — Document upload, parsing & embedding.
// AC-2.4 runs against a live Supabase (local CLI). Cross-tenant vector retrieval
// is a P0 compliance guarantee (a lab must never see another lab's chunks) and
// is NEVER mocked. The other ACs land as built.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && anonKey && serviceKey);

const PASSWORD = "Test-Passw0rd!";
const DIM = 1536;

// A unit basis vector e_hot in R^1536, serialized as pgvector text.
// Distinct hot indices → orthogonal → cosine similarity 0 (well below the 0.75 gate).
function basisVec(hot: number): string {
  const arr = new Array(DIM).fill(0);
  arr[hot] = 1;
  return `[${arr.join(",")}]`;
}

async function makeTenantWithChunk(
  admin: SupabaseClient,
  name: string,
  emailPrefix: string,
  embedding: string
) {
  const { data: tenant, error: tErr } = await admin
    .from("tenants")
    .insert({ name })
    .select()
    .single();
  if (tErr) throw tErr;

  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@labbrain.test`;
  const { data: created, error: uErr } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true
  });
  if (uErr) throw uErr;

  const { error: linkErr } = await admin
    .from("users")
    .insert({ id: created.user.id, tenant_id: tenant.id, email, role: "owner" });
  if (linkErr) throw linkErr;

  const { data: doc, error: dErr } = await admin
    .from("documents")
    .insert({
      tenant_id: tenant.id,
      filename: `${name}.pdf`,
      storage_path: `${tenant.id}/${name}.pdf`,
      status: "ready"
    })
    .select()
    .single();
  if (dErr) throw dErr;

  const { error: cErr } = await admin.from("document_chunks").insert({
    tenant_id: tenant.id,
    document_id: doc.id,
    chunk_index: 0,
    content: `${name} secret clause`,
    page_number: 1,
    section: `${name} section`,
    embedding
  });
  if (cErr) throw cErr;

  return { tenantId: tenant.id as string, email, docId: doc.id as string };
}

describe.skipIf(!hasLiveSupabase)("Story 2 — Upload & indexing", () => {
  let admin: SupabaseClient;
  let labA: { tenantId: string; email: string; docId: string };
  let labB: { tenantId: string; email: string; docId: string };
  let clientA: SupabaseClient;

  const vecA = basisVec(0);
  const vecB = basisVec(1);

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    labA = await makeTenantWithChunk(admin, "LabA", "owner-a", vecA);
    labB = await makeTenantWithChunk(admin, "LabB", "owner-b", vecB);

    clientA = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { error } = await clientA.auth.signInWithPassword({
      email: labA.email,
      password: PASSWORD
    });
    if (error) throw error;
  });

  afterAll(async () => {
    if (admin && labA) await admin.from("tenants").delete().eq("id", labA.tenantId);
    if (admin && labB) await admin.from("tenants").delete().eq("id", labB.tenantId);
  });

  it("@AC-2.4 match_document_chunks returns only the caller's tenant chunks", async () => {
    // Query with Lab A's own embedding → its chunk scores ~1.0, well above gate.
    const { data, error } = await clientA.rpc("match_document_chunks", {
      query_embedding: vecA,
      match_count: 10,
      similarity_threshold: 0.75
    });
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((row: { document_id: string }) => row.document_id === labA.docId)).toBe(true);
    expect(data!.some((row: { document_id: string }) => row.document_id === labB.docId)).toBe(false);
  });

  it("@AC-2.4 Lab A cannot retrieve Lab B chunks even with Lab B's exact embedding", async () => {
    // Query with Lab B's exact embedding. The RPC filters tenant_id BEFORE
    // similarity, so Lab B's perfectly-matching chunk is invisible, and Lab A's
    // own (orthogonal) chunk scores 0 < 0.75 → zero rows.
    const { data, error } = await clientA.rpc("match_document_chunks", {
      query_embedding: vecB,
      match_count: 10,
      similarity_threshold: 0.75
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // AC-2.1/2.2/2.3 → tests/story-2-documents-routes.test.ts (HTTP seam, live)
  //               + tests/story-2-helpers.test.ts (chunk + validation units).
  // AC-2.5/2.6   → tests/story-2-documents-routes.test.ts (list/delete + cap 402).
});
