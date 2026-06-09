import type { Lang } from "./lang";
import { resolveOpenAiBackend } from "@/lib/ai/inference-mode";
import { getOpenAiClient } from "@/lib/ai/openai-client";

// S17 — cross-lingual query expansion. Translate the question into the OTHER project
// language (ar→en, en→ar) so retrieval can also embed the cross-language form. This
// closes the measured gap where an Arabic question against an English standard (or
// vice-versa) scores below the similarity gate purely for lack of shared tokens.
//
// Translation rides the SAME inference seam as answering (`resolveOpenAiBackend
// ("answer")`), so in air-gap mode (S11) the local model does it and nothing reaches
// the cloud. Temperature 0 for determinism. The result is an internal retrieval aid
// only — it is never persisted to the audit log or shown to the user (AC-17.6).

// Build the translate instruction. We hand the model the SAME domain invariants the
// answer system prompt enforces (AC-17.2): clause numbers, units, accreditation-body
// names, and embedded English technical terms must survive verbatim, or the translated
// query would no longer match the passage it is meant to find.
function buildTranslatePrompt(lang: Lang): string {
  const target = lang === "ar" ? "English" : "Arabic";
  return [
    `Translate the user's question into ${target}.`,
    "It is a search query used to retrieve passages from ISO/IEC 17025 laboratory documents.",
    "Preserve verbatim, without translating or transliterating: ISO clause numbers (e.g. 17025, 4.1),",
    "measurement units, accreditation-body names (e.g. JISM), and any embedded English technical terms.",
    "Output ONLY the translated query — no quotes, no preamble, no explanation."
  ].join(" ");
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// Returns the translated query, or null when expansion should be skipped — the model
// errored, returned nothing, or returned (effectively) the original. On null the
// caller degrades to single-embedding retrieval (AC-17.5, fail-open). This function
// never throws.
export async function translateQuery(question: string, lang: Lang): Promise<string | null> {
  try {
    const backend = resolveOpenAiBackend("answer");
    const client = getOpenAiClient(backend);
    const res = await client.chat.completions.create({
      model: backend.model,
      temperature: 0,
      messages: [
        { role: "system", content: buildTranslatePrompt(lang) },
        { role: "user", content: question }
      ]
    });
    const out = res.choices[0]?.message?.content?.trim() ?? "";
    if (!out) return null;
    if (normalize(out) === normalize(question)) return null;
    return out;
  } catch {
    return null;
  }
}
