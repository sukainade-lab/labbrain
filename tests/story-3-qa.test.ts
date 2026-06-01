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
import { NOT_FOUND_AR, NOT_FOUND } from "@/lib/qa/prompt";

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
  let otherTenantId: string; // Lab B — used to prove cross-tenant isolation.
  let emptyTenantId: string; // Lab C — a brand-new lab with no documents at all.
  let emptyUserId: string;
  let emptyClient: SupabaseClient; // signed in as Lab C.

  // Lab B's chunk sits at a distinct basis index so Lab A's own chunk (index 0)
  // scores 0 against a query at B's index. Filtering must hide B regardless.
  const OTHER_INDEX = 7;

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

    // ── Lab B (the adversary tenant) ─────────────────────────────────────────
    // A second, fully independent lab whose one chunk sits at OTHER_INDEX. We
    // never sign in as Lab B; it exists only so that a Lab A query aimed exactly
    // at Lab B's embedding proves the RPC's tenant filter — not cosine distance —
    // is what hides B. (Lab A's own chunk is at index 0 → scores 0 here too.)
    const { data: otherTenant, error: otErr } = await admin
      .from("tenants")
      .insert({ name: "QA-Lab-B" })
      .select()
      .single();
    if (otErr) throw otErr;
    otherTenantId = otherTenant.id;

    const otherEmail = `qa-owner-b-${Date.now()}-${Math.random().toString(36).slice(2)}@labbrain.test`;
    const { data: otherCreated, error: ouErr } = await admin.auth.admin.createUser({
      email: otherEmail,
      password: PASSWORD,
      email_confirm: true
    });
    if (ouErr) throw ouErr;

    const { error: otherLinkErr } = await admin
      .from("users")
      .insert({ id: otherCreated.user.id, tenant_id: otherTenantId, email: otherEmail, role: "owner" });
    if (otherLinkErr) throw otherLinkErr;

    const { data: otherDoc, error: odErr } = await admin
      .from("documents")
      .insert({
        tenant_id: otherTenantId,
        filename: "وثيقة المختبر ب — سرية.pdf",
        storage_path: `${otherTenantId}/secret.pdf`,
        status: "ready"
      })
      .select()
      .single();
    if (odErr) throw odErr;

    const { error: ocErr } = await admin.from("document_chunks").insert({
      tenant_id: otherTenantId,
      document_id: otherDoc.id,
      chunk_index: 0,
      content: "سر المختبر ب: تُعاير الموازين كل 6 أشهر.",
      page_number: 3,
      section: "2.1",
      embedding: basisLiteral(OTHER_INDEX)
    });
    if (ocErr) throw ocErr;

    client = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { error: signInErr } = await client.auth.signInWithPassword({
      email,
      password: PASSWORD
    });
    if (signInErr) throw signInErr;

    // ── Lab C (empty corpus) ─────────────────────────────────────────────────
    // A brand-new lab: tenant + owner, but zero documents. Proves the
    // empty-corpus signal (UI nudges "upload first") versus a real miss.
    const { data: emptyTenant, error: etErr } = await admin
      .from("tenants")
      .insert({ name: "QA-Lab-C" })
      .select()
      .single();
    if (etErr) throw etErr;
    emptyTenantId = emptyTenant.id;

    const emptyEmail = `qa-owner-c-${Date.now()}-${Math.random().toString(36).slice(2)}@labbrain.test`;
    const { data: emptyCreated, error: euErr } = await admin.auth.admin.createUser({
      email: emptyEmail,
      password: PASSWORD,
      email_confirm: true
    });
    if (euErr) throw euErr;
    emptyUserId = emptyCreated.user.id;

    const { error: emptyLinkErr } = await admin
      .from("users")
      .insert({ id: emptyUserId, tenant_id: emptyTenantId, email: emptyEmail, role: "owner" });
    if (emptyLinkErr) throw emptyLinkErr;

    emptyClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { error: emptySignInErr } = await emptyClient.auth.signInWithPassword({
      email: emptyEmail,
      password: PASSWORD
    });
    if (emptySignInErr) throw emptySignInErr;
  });

  afterAll(async () => {
    if (admin && tenantId) await admin.from("tenants").delete().eq("id", tenantId);
    if (admin && otherTenantId) await admin.from("tenants").delete().eq("id", otherTenantId);
    if (admin && emptyTenantId) await admin.from("tenants").delete().eq("id", emptyTenantId);
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
    // The lab HAS a ready document — this is a genuine miss, not an empty corpus.
    expect(result.emptyCorpus).toBe(false);

    const { data: rows, error } = await admin
      .from("queries")
      .select("found_answer, question_lang")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1);
    expect(error).toBeNull();
    expect(rows![0]).toMatchObject({ found_answer: false, question_lang: "ar" });
  });

  it("@AC-3.5 model refuses on off-topic chunks → refusal in the user's language", async () => {
    // Chunks ARE retrieved (gate cleared), but the model judges them off-topic and
    // emits the Arabic sentinel. For an English question the refusal must come back
    // in English, not the raw Arabic sentinel the grounding prompt dictates.
    vi.mocked(embedTexts).mockResolvedValueOnce([basisArray(0)]);
    vi.mocked(generateAnswer).mockResolvedValueOnce(NOT_FOUND_AR);

    const result = await ask({
      supabase: client,
      tenantId,
      userId,
      question: "What is the audit retention policy for purchase orders?"
    });

    expect(generateAnswer).toHaveBeenCalledTimes(1); // chunks existed → model ran
    expect(result.found).toBe(false);
    expect(result.lang).toBe("en");
    expect(result.answer).toBe(NOT_FOUND.en);
    expect(result.citations).toEqual([]);
  });

  it("@AC-3.2 (P0) Lab A querying Lab B's exact embedding retrieves nothing", async () => {
    // The hardest isolation case: Lab A fires a query embedding that lands EXACTLY
    // on Lab B's chunk (cosine 1.0). If the RPC filtered on cosine alone, B's
    // secret would surface cross-tenant — the worst possible compliance breach.
    // The tenant filter runs BEFORE cosine, so Lab A sees only its own corpus,
    // where this embedding scores 0 (orthogonal to index 0) → below the gate.
    // Result: not-found, and the model is NEVER handed Lab B's content.
    vi.mocked(embedTexts).mockResolvedValueOnce([basisArray(OTHER_INDEX)]);

    const result = await ask({
      supabase: client, // still signed in as Lab A
      tenantId,
      userId,
      question: "ما هو سر المختبر ب؟"
    });

    expect(result.found).toBe(false);
    expect(result.citations).toEqual([]);
    expect(generateAnswer).not.toHaveBeenCalled();
  });

  it("@AC-3.5 a lab with no documents → not-found flagged as empty corpus", async () => {
    // Lab C has never uploaded anything. The miss must be flagged emptyCorpus so
    // the UI nudges "upload first" rather than implying its files were searched.
    // The model is never called — there is nothing to ground against.
    vi.mocked(embedTexts).mockResolvedValueOnce([basisArray(0)]);

    const result = await ask({
      supabase: emptyClient, // signed in as Lab C (zero documents)
      tenantId: emptyTenantId,
      userId: emptyUserId,
      question: "What is the calibration interval for class E2 weights?"
    });

    expect(result.found).toBe(false);
    expect(result.emptyCorpus).toBe(true);
    expect(result.citations).toEqual([]);
    expect(generateAnswer).not.toHaveBeenCalled();
  });
});
