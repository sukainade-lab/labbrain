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

  if (chunks.length === 0) {
    // AC-3.5 (P0 safety contract) — nothing cleared the 0.75 gate. Return the
    // "not found" message in the user's language and DO NOT call the model. There
    // is no general-knowledge fallback path, by design.
    answer = NOT_FOUND[lang];
    citations = [];
    found = false;
  } else {
    answer = await generateAnswer({ question, chunks, lang });
    // The model can still refuse if the excerpts are off-topic (AC-3.3).
    found = !isNotFoundAnswer(answer);
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

  return { answer, citations, found, lang };
}
