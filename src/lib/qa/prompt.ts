import type { Lang } from "./lang";
import type { RetrievedChunk } from "./types";

// AC-3.3 — the exact sentinel the model must return when the answer is not in the
// excerpts. Also the message returned when retrieval finds nothing (AC-3.5).
export const NOT_FOUND_AR = "لم أجد إجابة لهذا السؤال في وثائقكم.";
export const NOT_FOUND_EN = "I couldn't find an answer to this question in your documents.";

export const NOT_FOUND: Record<Lang, string> = {
  ar: NOT_FOUND_AR,
  en: NOT_FOUND_EN
};

// AC-3.3 — strict grounding contract. The instruction to answer only from the
// excerpts (and the exact refusal sentinel) is verbatim from the BRD. This is the
// product's P0 safety contract: no general-knowledge fallback, ever.
export function buildSystemPrompt(lang: Lang): string {
  const langLine =
    lang === "ar"
      ? "Answer in Arabic, in a professional Jordanian tone."
      : "Answer in English, professionally and concisely.";
  return [
    "You are LabBrain, an assistant for an ISO/IEC 17025 accredited laboratory.",
    "Answer only from the provided document excerpts.",
    // Refuse in the SAME language the answer is written in. A cross-language
    // sentinel (e.g. an Arabic refusal on an English answer) at temp 0 makes the
    // model paraphrase the refusal in its answer language, which would slip past
    // detection and get logged found_answer=true with citations attached to a
    // refusal — a P0 compliance-log integrity bug.
    `If the answer is not present in the excerpts, respond with exactly: '${NOT_FOUND[lang]}'`,
    "Do not generate information not present in the source.",
    langLine,
    "Never translate ISO clause numbers, measurement units, or accreditation body names."
  ].join("\n");
}

// Turn retrieved chunks into a numbered context block the model cites against.
export function formatContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => {
      const head = c.section
        ? `[${i + 1}] ${c.document_filename} — ${c.section} (page ${c.page_number ?? "?"})`
        : `[${i + 1}] ${c.document_filename} (page ${c.page_number ?? "?"})`;
      return `${head}\n${c.content}`;
    })
    .join("\n\n");
}

// Normalise model output for tolerant sentinel matching: collapse runs of
// whitespace, fold typographic apostrophes/quotes to ASCII (GPT often emits a
// curly ’ in "couldn't"), and drop trailing sentence punctuation the model adds
// or drops. Applied to both the answer and the sentinels so a missing period or a
// fancy apostrophe never causes a refusal to be mislabelled as a found answer.
function normaliseForMatch(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[‘’‛ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!。！]+$/u, "")
    .trim();
}

const NOT_FOUND_NORMALISED = [NOT_FOUND_AR, NOT_FOUND_EN].map(normaliseForMatch);

// The model may still emit the refusal sentinel even when chunks were retrieved
// (e.g. the excerpts are off-topic). Treat that as "not found" for found_answer.
// Must catch a refusal in EITHER language (the prompt now refuses in the answer's
// language) and must NEVER let a non-grounded answer through:
//   - an empty / whitespace-only model response is treated as not-found, so it can
//     never be logged found_answer=true with citations attached (P0 safety);
//   - matching is substring-based on the normalised text, so a refusal carrying a
//     leading hedge ("Unfortunately, …") or trailing nudge ("… please upload.")
//     is still recognised.
export function isNotFoundAnswer(answer: string): boolean {
  const norm = normaliseForMatch(answer);
  if (norm.length === 0) return true;
  return NOT_FOUND_NORMALISED.some((sentinel) => norm.includes(sentinel));
}
