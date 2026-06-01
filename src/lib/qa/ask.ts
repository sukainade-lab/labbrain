import type { SupabaseClient } from "@supabase/supabase-js";
import { detectLang, type Lang } from "./lang";
import { embedTexts, toVectorLiteral } from "@/lib/ai/embeddings";
import { generateAnswer } from "@/lib/ai/answer";
import { buildCitations, type Citation } from "./citations";
import { NOT_FOUND, isNotFoundAnswer } from "./prompt";
import type { RetrievedChunk } from "./types";

// AC-3.2 — top-5 chunks, cosine similarity gate at 0.75.
export const MATCH_COUNT = 5;
export const SIMILARITY_THRESHOLD = 0.75;

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

  const [embedding] = await embedTexts([question]);
  if (!embedding) throw new Error("failed to embed the question");

  const { data, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: toVectorLiteral(embedding),
    match_count: MATCH_COUNT,
    similarity_threshold: SIMILARITY_THRESHOLD
  });
  if (error) throw new Error(`retrieval failed: ${error.message}`);
  const chunks = (data ?? []) as RetrievedChunk[];

  let answer: string;
  let citations: Citation[];
  let found: boolean;
  let emptyCorpus = false;

  if (chunks.length === 0) {
    // AC-3.5 (P0 safety contract) — nothing cleared the 0.75 gate. Return the
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
    // The model can still refuse if the excerpts are off-topic (AC-3.3). The
    // grounding prompt always emits the Arabic sentinel, so normalise a refusal
    // back to the user's language — AC-3.5 requires "not found" in their language,
    // whether the gate (no chunks) or the model produced it.
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
