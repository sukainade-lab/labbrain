import type { Lang } from "./lang";
import type { RetrievedChunk } from "./types";

// AC-3.3 — the exact sentinel the model must return when the answer is not in the
// excerpts. Also the message returned when retrieval finds nothing (AC-3.5).
export const NOT_FOUND_AR = "لم أجد إجابة لهذا السؤال في وثائقكم.";
const NOT_FOUND_EN = "I couldn't find an answer to this question in your documents.";

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
    `If the answer is not present, respond with: '${NOT_FOUND_AR}'`,
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

// The model may still emit the refusal sentinel even when chunks were retrieved
// (e.g. the excerpts are off-topic). Treat that as "not found" for found_answer.
export function isNotFoundAnswer(answer: string): boolean {
  return answer.trim().includes(NOT_FOUND_AR);
}
