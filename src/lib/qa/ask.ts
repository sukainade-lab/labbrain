import type { SupabaseClient } from "@supabase/supabase-js";
import { detectLang, type Lang } from "./lang";
import { embedTexts, toVectorLiteral } from "@/lib/ai/embeddings";
import { generateAnswer } from "@/lib/ai/answer";
import { translateQuery } from "./translate";
import { mergeRetrieved } from "./merge";
import { buildCitations, type Citation } from "./citations";
import { NOT_FOUND, isNotFoundAnswer } from "./prompt";
import type { RetrievedChunk } from "./types";

// AC-3.2 — top-5 chunks, cosine similarity gate.
export const MATCH_COUNT = 5;
// Cosine gate, calibrated for text-embedding-3-small (the embedding model in use).
//
// A short user question vs a long document passage scores in ~0.30–0.55 cosine
// even for a genuine on-topic match with this model — far below 0.75. The original
// 0.75 gate sat at the top of the achievable range and STARVED retrieval: in
// production (tenant with the ISO/IEC 17025 standard indexed, 64 healthy chunks)
// only 1 of 17 questions cleared it (5.9% found-rate), and that one match scraped
// in at 0.756. Questions answerable straight from the document ("what is
// impartiality?", "what is the management system requirement?") were all refused.
//
// 0.35 restores recall. This does NOT weaken the zero-hallucination contract: the
// real precision guard is the LLM grounding contract (answer ONLY from excerpts +
// isNotFoundAnswer canonicalisation, prompt.ts), which still refuses anything the
// retrieved text does not support. The gate is only a coarse pre-filter that keeps
// wholly-irrelevant chunks out of the model's context. Regression-pinned in
// tests/story-3-qa-calibration.test.ts.
export const SIMILARITY_THRESHOLD = 0.35;

// S17 — bilingual (cross-lingual) query expansion kill-switch. Default ON. Set
// QA_BILINGUAL_EXPANSION to "0", "false", or "off" (case-insensitive) to disable
// and fall back to single-embedding retrieval (today's behaviour). The env var is
// read at call time so an operator can flip it without a redeploy.
export function bilingualExpansionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.QA_BILINGUAL_EXPANSION ?? "").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}

// One tenant-filtered retrieval pass. Reuses the existing, isolation-tested
// match_document_chunks RPC (migration 0004) — S17 adds NO schema or RPC changes.
async function retrieve(supabase: SupabaseClient, embedding: number[]): Promise<RetrievedChunk[]> {
  const { data, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: toVectorLiteral(embedding),
    match_count: MATCH_COUNT,
    similarity_threshold: SIMILARITY_THRESHOLD
  });
  if (error) throw new Error(`retrieval failed: ${error.message}`);
  return (data ?? []) as RetrievedChunk[];
}

export interface QaResult {
  answer: string;
  citations: Citation[];
  found: boolean;
  lang: Lang;
  // True only when a not-found is caused by an empty corpus (no indexed
  // documents), not by a real miss. Lets the UI nudge "upload first" instead of
  // implying the lab's documents were searched and came up short (AC-3.5 UX).
  emptyCorpus: boolean;
}

// The Q&A orchestrator. `supabase` MUST be the caller's user-scoped client (cookie
// session): the RPC and the queries insert both rely on current_tenant_id(), which
// resolves via auth.uid(). The service-role admin client would resolve to a null
// tenant and silently retrieve nothing — never use it here.
export async function ask(params: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  question: string;
}): Promise<QaResult> {
  const { supabase, tenantId, userId, question } = params;
  const lang = detectLang(question);

  // S17 — cross-lingual query expansion (app-side union). When enabled (default),
  // translate the question into the OTHER project language and embed BOTH forms in a
  // single batched call, then run match_document_chunks once per embedding IN PARALLEL
  // and merge the result sets (dedupe by id, keep the highest similarity). This closes
  // the measured gap where an Arabic question against an English standard scores below
  // the gate purely for lack of shared tokens.
  //
  // Fail-open: translateQuery returns null on any miss (model error/empty/echo, or the
  // kill-switch off), in which case we embed + retrieve once — exactly today's path. The
  // answer is always generated from the ORIGINAL question in the user's language (the
  // translation is an internal retrieval aid only, AC-17.4 / AC-17.6).
  const translated = bilingualExpansionEnabled() ? await translateQuery(question, lang) : null;
  const queries = translated ? [question, translated] : [question];

  const embeddings = await embedTexts(queries);
  if (!embeddings[0]) throw new Error("failed to embed the question");

  const resultSets = await Promise.all(embeddings.map((embedding) => retrieve(supabase, embedding)));
  const chunks = mergeRetrieved(resultSets, MATCH_COUNT);

  let answer: string;
  let citations: Citation[];
  let found: boolean;
  let emptyCorpus = false;

  if (chunks.length === 0) {
    // AC-3.5 (P0 safety contract) — nothing cleared the similarity gate. Return the
    // "not found" message in the user's language and DO NOT call the model. There
    // is no general-knowledge fallback path, by design.
    answer = NOT_FOUND[lang];
    citations = [];
    found = false;
    // Distinguish "no documents to search" from "searched, no match" so the UI
    // can guide a brand-new lab to upload first. Cheap head count, only on the
    // miss path; RLS scopes it to this tenant.
    const { count } = await supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("status", "ready");
    emptyCorpus = (count ?? 0) === 0;
  } else {
    answer = await generateAnswer({ question, chunks, lang });
    // The model can still refuse if the excerpts are off-topic (AC-3.3).
    // isNotFoundAnswer catches a refusal in either language (and an empty answer),
    // and we re-canonicalise it to the exact sentinel for this lang so the audit
    // log + UI always show the verbatim AC-3.5 message — whether the gate (no
    // chunks) or the model produced the miss.
    found = !isNotFoundAnswer(answer);
    if (!found) answer = NOT_FOUND[lang];
    citations = found ? buildCitations(chunks) : [];
  }

  // AC-3.7 — persist every Q&A to the audit log. A failure here is a broken
  // compliance contract, so surface it rather than swallowing it.
  const { error: logError } = await supabase.from("queries").insert({
    tenant_id: tenantId,
    user_id: userId,
    question_text: question,
    question_lang: lang,
    answer_text: answer,
    citations,
    found_answer: found
  });
  if (logError) throw new Error(`failed to log query: ${logError.message}`);

  return { answer, citations, found, lang, emptyCorpus };
}
