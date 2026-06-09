import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RetrievedChunk } from "@/lib/qa/types";

// S17 — bilingual query expansion orchestration, fully mocked (no live DB).
// embedTexts, generateAnswer, and translateQuery are mocked; toVectorLiteral stays
// real so the literal handed to the RPC is exactly what production sends.

vi.mock("@/lib/ai/embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/embeddings")>();
  return { ...actual, embedTexts: vi.fn() };
});
vi.mock("@/lib/ai/answer", () => ({ generateAnswer: vi.fn() }));
vi.mock("@/lib/qa/translate", () => ({ translateQuery: vi.fn() }));

import { ask } from "@/lib/qa/ask";
import { embedTexts } from "@/lib/ai/embeddings";
import { generateAnswer } from "@/lib/ai/answer";
import { translateQuery } from "@/lib/qa/translate";

const DIM = 1536;
function basisArray(hot: number): number[] {
  const arr = new Array(DIM).fill(0);
  arr[hot] = 1;
  return arr;
}

function chunk(id: string, similarity: number): RetrievedChunk {
  return {
    id,
    document_id: `doc-${id}`,
    document_filename: `${id}.pdf`,
    content: `content ${id}`,
    page_number: 1,
    section: "4.1",
    similarity
  };
}

// A fake user-scoped Supabase client: rpc returns queued result sets; the queries
// insert and the documents head-count are captured.
function makeSupabase(rpcResults: Array<{ data: RetrievedChunk[]; error: null }>) {
  const rpc = vi.fn();
  for (const r of rpcResults) rpc.mockResolvedValueOnce(r);
  const insert = vi.fn().mockResolvedValue({ error: null });
  const documentsHead = vi.fn().mockResolvedValue({ count: 1 });
  const from = vi.fn((table: string) => {
    if (table === "queries") return { insert };
    // documents head-count on the empty-corpus path
    return {
      select: () => ({ eq: () => documentsHead() })
    };
  });
  return { client: { rpc, from } as unknown as SupabaseClient, rpc, insert };
}

const baseParams = { tenantId: "t1", userId: "u1" };

describe("S17 bilingual query expansion (orchestrator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.QA_BILINGUAL_EXPANSION; // default = on
  });
  afterEach(() => {
    delete process.env.QA_BILINGUAL_EXPANSION;
  });

  it("@AC-17.1 @AC-17.3 on + translation present → two RPC calls, merged results", async () => {
    vi.mocked(translateQuery).mockResolvedValueOnce("what is impartiality?");
    // One batched embed call for both queries → two vectors.
    vi.mocked(embedTexts).mockResolvedValueOnce([basisArray(0), basisArray(1)]);
    // Original-lang retrieval finds a weak hit; cross-lang retrieval finds a strong one.
    const sup = makeSupabase([
      { data: [chunk("a", 0.36)], error: null },
      { data: [chunk("a", 0.71), chunk("b", 0.55)], error: null }
    ]);
    vi.mocked(generateAnswer).mockResolvedValueOnce("الحيادية هي ...");

    const result = await ask({ ...baseParams, supabase: sup.client, question: "ما هي الحيادية؟" });

    expect(translateQuery).toHaveBeenCalledWith("ما هي الحيادية؟", "ar");
    expect(vi.mocked(embedTexts).mock.calls[0][0]).toEqual(["ما هي الحيادية؟", "what is impartiality?"]);
    expect(sup.rpc).toHaveBeenCalledTimes(2);
    expect(result.found).toBe(true);
    expect(result.lang).toBe("ar"); // answer stays in the original question's language
    // merged + deduped: chunk a (max 0.71) then b → 2 citations
    expect(result.citations).toHaveLength(2);
    expect(result.citations[0].similarity).toBe(0.71);
  });

  it("@AC-17.4 answer path unchanged: generateAnswer gets the merged chunks, original question", async () => {
    vi.mocked(translateQuery).mockResolvedValueOnce("what is impartiality?");
    vi.mocked(embedTexts).mockResolvedValueOnce([basisArray(0), basisArray(1)]);
    makeSupabase([
      { data: [chunk("a", 0.36)], error: null },
      { data: [chunk("a", 0.71)], error: null }
    ]);
    const sup = makeSupabase([
      { data: [chunk("a", 0.36)], error: null },
      { data: [chunk("a", 0.71)], error: null }
    ]);
    vi.mocked(generateAnswer).mockResolvedValueOnce("الحيادية هي ...");

    await ask({ ...baseParams, supabase: sup.client, question: "ما هي الحيادية؟" });

    const arg = vi.mocked(generateAnswer).mock.calls[0][0];
    expect(arg.question).toBe("ما هي الحيادية؟");
    expect(arg.lang).toBe("ar");
    expect(arg.chunks.map((c) => c.id)).toEqual(["a"]);
    expect(arg.chunks[0].similarity).toBe(0.71);
  });

  it("@AC-17.6 audit log records only the original question/lang (never the translation)", async () => {
    vi.mocked(translateQuery).mockResolvedValueOnce("what is impartiality?");
    vi.mocked(embedTexts).mockResolvedValueOnce([basisArray(0), basisArray(1)]);
    const sup = makeSupabase([
      { data: [chunk("a", 0.71)], error: null },
      { data: [], error: null }
    ]);
    vi.mocked(generateAnswer).mockResolvedValueOnce("الحيادية هي ...");

    const result = await ask({ ...baseParams, supabase: sup.client, question: "ما هي الحيادية؟" });

    expect(sup.insert).toHaveBeenCalledTimes(1);
    const logged = sup.insert.mock.calls[0][0];
    expect(logged.question_text).toBe("ما هي الحيادية؟");
    expect(logged.question_lang).toBe("ar");
    expect(JSON.stringify(logged)).not.toContain("what is impartiality?");
    expect(result.found).toBe(true);
  });

  it("@AC-17.5 fail-open: translation null → single embed + single RPC (today's behaviour)", async () => {
    vi.mocked(translateQuery).mockResolvedValueOnce(null);
    vi.mocked(embedTexts).mockResolvedValueOnce([basisArray(0)]);
    const sup = makeSupabase([{ data: [chunk("a", 0.71)], error: null }]);
    vi.mocked(generateAnswer).mockResolvedValueOnce("answer");

    const result = await ask({ ...baseParams, supabase: sup.client, question: "ما هي الحيادية؟" });

    expect(vi.mocked(embedTexts).mock.calls[0][0]).toEqual(["ما هي الحيادية؟"]);
    expect(sup.rpc).toHaveBeenCalledTimes(1);
    expect(result.found).toBe(true);
  });

  it("@AC-17.7 kill-switch off → translateQuery never called, single embed + single RPC", async () => {
    process.env.QA_BILINGUAL_EXPANSION = "0";
    vi.mocked(embedTexts).mockResolvedValueOnce([basisArray(0)]);
    const sup = makeSupabase([{ data: [chunk("a", 0.71)], error: null }]);
    vi.mocked(generateAnswer).mockResolvedValueOnce("answer");

    const result = await ask({ ...baseParams, supabase: sup.client, question: "ما هي الحيادية؟" });

    expect(translateQuery).not.toHaveBeenCalled();
    expect(vi.mocked(embedTexts).mock.calls[0][0]).toEqual(["ما هي الحيادية؟"]);
    expect(sup.rpc).toHaveBeenCalledTimes(1);
    expect(result.found).toBe(true);
  });

  it("@AC-17.7 kill-switch 'false' and 'off' also disable expansion", async () => {
    for (const val of ["false", "OFF"]) {
      vi.clearAllMocks();
      process.env.QA_BILINGUAL_EXPANSION = val;
      vi.mocked(embedTexts).mockResolvedValueOnce([basisArray(0)]);
      const sup = makeSupabase([{ data: [chunk("a", 0.71)], error: null }]);
      vi.mocked(generateAnswer).mockResolvedValueOnce("answer");
      await ask({ ...baseParams, supabase: sup.client, question: "ما هي الحيادية؟" });
      expect(translateQuery).not.toHaveBeenCalled();
    }
  });
});
