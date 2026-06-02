import type { Lang } from "@/lib/qa/lang";
import type { RetrievedChunk } from "@/lib/qa/types";
import { buildSystemPrompt, formatContext } from "@/lib/qa/prompt";
import { ANSWER_MODEL } from "./constants";
import { resolveOpenAiBackend } from "./inference-mode";
import { getOpenAiClient } from "./openai-client";

// Re-export for back-compat with existing importers of this constant.
export { ANSWER_MODEL };

// Generate a grounded answer from retrieved chunks (AC-3.2/3.3). The backend
// (cloud GPT-4o-mini vs local Ollama) is resolved per call from INFERENCE_MODE
// (S11/AC-11.3) — the grounding contract (system prompt, temperature 0, no-chunk
// path) is identical across modes. The caller only invokes this when at least one
// chunk cleared the similarity gate — the no-chunk path (AC-3.5) never reaches here.
export async function generateAnswer(params: {
  question: string;
  chunks: RetrievedChunk[];
  lang: Lang;
}): Promise<string> {
  const backend = resolveOpenAiBackend("answer");
  const client = getOpenAiClient(backend);
  const res = await client.chat.completions.create({
    model: backend.model,
    temperature: 0,
    messages: [
      { role: "system", content: buildSystemPrompt(params.lang) },
      {
        role: "user",
        content: `Document excerpts:\n\n${formatContext(params.chunks)}\n\nQuestion: ${params.question}`
      }
    ]
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
}
