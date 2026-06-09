import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { embedTexts, toVectorLiteral } from "@/lib/ai/embeddings";

// S17 AC-17.8 — the headline PROOF, end-to-end against real infra (lesson L2:
// serialized, unique-tenant scoped, cleans up in afterAll; CI runs the live job
// with --no-file-parallelism). This is the test that the whole story exists for.
//
// It reproduces the measured gap (2026-06-09): an Arabic question asked against an
// ENGLISH-only corpus. With NO mocks on the AI seams — real text-embedding-3-small
// embeddings AND a real cross-lingual translation through the answer model — we
// prove:
//
//   expansion ON  → the Arabic question "ما هي الحيادية؟" retrieves the English
//                   impartiality passage (the translated EN form clears the gate)
//                   → found = true, ≥ 1 citation.
//   expansion OFF → the same Arabic question, single-embedding only, scores below
//                   the gate against the English passage → not found.
//
// Only generateAnswer is mocked (to a grounded, non-refusal Arabic answer): the
// answer-generation contract is covered elsewhere, and AC-17.8 is purely about
// whether RETRIEVAL clears the gate. found therefore hinges solely on whether
// bilingual expansion put a matching chunk in front of the model — exactly the
// behaviour the story changes.
//
// Needs both live Supabase AND a real OpenAI key (genuine cross-lingual embeddings
// can't be faked). Skips cleanly otherwise.

vi.mock("@/lib/ai/answer", () => ({ generateAnswer: vi.fn() }));
import { ask } from "@/lib/qa/ask";
import { generateAnswer } from "@/lib/ai/answer";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Real translation rides the answer seam (cloud OpenAI by default) — needs a key,
// unless an air-gap Ollama endpoint is configured for the local model.
const hasOpenAi = Boolean(process.env.OPENAI_API_KEY || process.env.OLLAMA_BASE_URL);
const canRun = Boolean(url && anonKey && serviceKey) && hasOpenAi;

const PASSWORD = "Test-Passw0rd!";

// ISO/IEC 17025 clause 4.1 — impartiality. The corpus is English ONLY; the lab
// engineer asks in Arabic. This is the exact shape that starved before S17.
const EN_IMPARTIALITY =
  "Impartiality means the presence of objectivity. Objectivity means that conflicts " +
  "of interest do not exist, or are resolved so as not to adversely influence " +
  "subsequent activities of the laboratory. The laboratory shall act impartially and " +
  "shall be responsible for the impartiality of its laboratory activities.";

const AR_QUESTION = "ما هي الحيادية؟"; // "What is impartiality?"

describe.skipIf(!canRun).sequential("S17 AC-17.8 — cross-lingual retrieval (live)", () => {
  let admin: SupabaseClient;
  let client: SupabaseClient;
  let tenantId = "";
  let userId = "";

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: tenant, error: tErr } = await admin
      .from("tenants")
      .insert({ name: `S17-Lab-${Date.now()}` })
      .select()
      .single();
    if (tErr) throw tErr;
    tenantId = tenant.id;

    const email = `s17-owner-${Date.now()}-${Math.random().toString(36).slice(2)}@labbrain.test`;
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
        filename: "ISO-IEC-17025.pdf",
        storage_path: `${tenantId}/iso-17025.pdf`,
        status: "ready"
      })
      .select()
      .single();
    if (dErr) throw dErr;

    // Seed ONE genuinely-English chunk with a REAL embedding (no basis-vector
    // fake). The cross-lingual match must come from semantics, not a planted index.
    const [embedding] = await embedTexts([EN_IMPARTIALITY]);
    if (!embedding) throw new Error("failed to embed the English passage");
    const { error: cErr } = await admin.from("document_chunks").insert({
      tenant_id: tenantId,
      document_id: doc.id,
      chunk_index: 0,
      content: EN_IMPARTIALITY,
      page_number: 4,
      section: "4.1",
      embedding: toVectorLiteral(embedding)
    });
    if (cErr) throw cErr;

    client = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInErr) throw signInErr;
  });

  afterAll(async () => {
    if (admin && tenantId) await admin.from("tenants").delete().eq("id", tenantId);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.QA_BILINGUAL_EXPANSION; // default ON
  });
  afterEach(() => {
    delete process.env.QA_BILINGUAL_EXPANSION;
  });

  it("@AC-17.8 expansion ON: an Arabic question finds the English passage", async () => {
    // Grounded answer so found hinges purely on retrieval clearing the gate.
    vi.mocked(generateAnswer).mockResolvedValueOnce(
      "الحيادية تعني وجود الموضوعية وعدم وجود تضارب في المصالح."
    );

    const result = await ask({ supabase: client, tenantId, userId, question: AR_QUESTION });

    expect(result.found).toBe(true);
    expect(result.lang).toBe("ar"); // answer stays in the question's language
    expect(result.citations.length).toBeGreaterThanOrEqual(1);
    expect(result.citations[0].page_number).toBe(4);
    expect(vi.mocked(generateAnswer)).toHaveBeenCalledTimes(1);
  });

  it("@AC-17.8 expansion OFF: the same Arabic question misses the English passage", async () => {
    process.env.QA_BILINGUAL_EXPANSION = "0";
    // generateAnswer must NOT be reached — nothing should clear the gate.
    vi.mocked(generateAnswer).mockResolvedValueOnce("should-not-be-used");

    const result = await ask({ supabase: client, tenantId, userId, question: AR_QUESTION });

    expect(result.found).toBe(false);
    expect(result.citations).toHaveLength(0);
    expect(vi.mocked(generateAnswer)).not.toHaveBeenCalled();
  });
});
