import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Story 3 — Bilingual source-traced Q&A (zero hallucination).
// This is the LIVE orchestrator test: ask() runs end-to-end against the real
// local Supabase (RPC match_document_chunks + the queries audit insert), with
// ONLY the OpenAI seams (embeddings + answer model) mocked. Retrieval and tenant
// isolation are P0 compliance guarantees and are never faked.
//   - Pure helpers → tests/story-3-qa-helpers.test.ts
//   - HTTP route seam (L1) → tests/story-3-qa-routes.test.ts

// embedTexts is mocked per-test to a chosen basis vector; toVectorLiteral stays
// real so the value handed to the RPC is exactly what production sends.
vi.mock("@/lib/ai/embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/embeddings")>();
  return { ...actual, embedTexts: vi.fn() };
});
// generateAnswer is mocked: the live test verifies the orchestration contract
// (when it is called, with what), not the model's wording.
vi.mock("@/lib/ai/answer", () => ({ generateAnswer: vi.fn() }));

import { ask } from "@/lib/qa/ask";
import { embedTexts } from "@/lib/ai/embeddings";
import { generateAnswer } from "@/lib/ai/answer";
import { NOT_FOUND_AR } from "@/lib/qa/prompt";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && anonKey && serviceKey);

const PASSWORD = "Test-Passw0rd!";
const DIM = 1536;
const FILENAME = "إجراء المعايرة — الكتلة.pdf";
const PAGE = 11;
const SECTION = "5.3";

// A unit basis vector e_hot in R^1536. Distinct hot indices are orthogonal →
// cosine 0 (far below the 0.75 gate); the same index → cosine 1.0.
function basisArray(hot: number): number[] {
  const arr = new Array(DIM).fill(0);
  arr[hot] = 1;
  return arr;
}
function basisLiteral(hot: number): string {
  return `[${basisArray(hot).join(",")}]`;
}

describe.skipIf(!hasLiveSupabase)("Story 3 — Q&A orchestrator (live)", () => {
  let admin: SupabaseClient;
  let client: SupabaseClient;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: tenant, error: tErr } = await admin
      .from("tenants")
      .insert({ name: "QA-Lab" })
      .select()
      .single();
    if (tErr) throw tErr;
    tenantId = tenant.id;

    const email = `qa-owner-${Date.now()}-${Math.random().toString(36).slice(2)}@labbrain.test`;
    const { data: created, error: uErr } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true
    });
    if (uErr) throw uErr;
    userId = created.user.id;

    const { error: linkErr } = await admin
      .from("users")
      .insert({ id: userId, tenant_id: tenantId, email, role: "owner" });
    if (linkErr) throw linkErr;

    const { data: doc, error: dErr } = await admin
      .from("documents")
      .insert({
        tenant_id: tenantId,
        filename: FILENAME,
        storage_path: `${tenantId}/calibration.pdf`,
        status: "ready"
      })
      .select()
      .single();
    if (dErr) throw dErr;

    // The lab's one chunk sits at basis index 0 → a query embedding at index 0
    // scores 1.0 (found); any other index scores 0 (not found).
    const { error: cErr } = await admin.from("document_chunks").insert({
      tenant_id: tenantId,
      document_id: doc.id,
      chunk_index: 0,
      content: "تتم معايرة كتل المعايرة من الفئة E2 كل 12 شهراً.",
      page_number: PAGE,
      section: SECTION,
      embedding: basisLiteral(0)
    });
    if (cErr) throw cErr;

    client = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { error: signInErr } = await client.auth.signInWithPassword({
      email,
      password: PASSWORD
    });
    if (signInErr) throw signInErr;
  });

  afterAll(async () => {
    if (admin && tenantId) await admin.from("tenants").delete().eq("id", tenantId);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("@AC-3.2 @AC-3.4 @AC-3.7 grounded match → answer with citation, logged", async () => {
    // Query embedding lands on the chunk's basis index → cosine 1.0 ≥ 0.75.
    vi.mocked(embedTexts).mockResolvedValueOnce([basisArray(0)]);
    vi.mocked(generateAnswer).mockResolvedValueOnce(
      "وفقاً للإجراء، تُعاير كتل الفئة E2 كل 12 شهراً."
    );

    const result = await ask({
      supabase: client,
      tenantId,
      userId,
      question: "What is the calibration interval for class E2 weights?"
    });

    expect(result.found).toBe(true);
    expect(result.lang).toBe("en");
    expect(generateAnswer).toHaveBeenCalledTimes(1);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({
      document_name: FILENAME,
      section: SECTION,
      page_number: PAGE
    });

    // AC-3.7 — the Q&A is persisted with lang, citations, and found flag.
    const { data: rows, error } = await admin
      .from("queries")
      .select("question_lang, found_answer, user_id, citations, answer_text")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1);
    expect(error).toBeNull();
    expect(rows![0]).toMatchObject({
      question_lang: "en",
      found_answer: true,
      user_id: userId
    });
    expect(rows![0].citations).toHaveLength(1);
  });

  it("@AC-3.5 (P0) no chunk clears the gate → not-found, model NEVER called", async () => {
    // Orthogonal query embedding → cosine 0 < 0.75 → RPC returns []. The
    // orchestrator MUST short-circuit to the refusal sentinel without touching
    // the model. A general-knowledge answer here is a P0 safety violation.
    vi.mocked(embedTexts).mockResolvedValueOnce([basisArray(5)]);

    const result = await ask({
      supabase: client,
      tenantId,
      userId,
      question: "ما هو إجراء معايرة جهاز لا نملك وثيقته؟"
    });

    expect(result.found).toBe(false);
    expect(result.lang).toBe("ar");
    expect(result.answer).toBe(NOT_FOUND_AR);
    expect(result.citations).toEqual([]);
    expect(generateAnswer).not.toHaveBeenCalled();

    const { data: rows, error } = await admin
      .from("queries")
      .select("found_answer, question_lang")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1);
    expect(error).toBeNull();
    expect(rows![0]).toMatchObject({ found_answer: false, question_lang: "ar" });
  });
});
