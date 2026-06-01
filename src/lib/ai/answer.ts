import OpenAI from "openai";
import type { Lang } from "@/lib/qa/lang";
import type { RetrievedChunk } from "@/lib/qa/types";
import { buildSystemPrompt, formatContext } from "@/lib/qa/prompt";

// Lazy client: OpenAI's constructor throws on a missing key, which would crash at
// module-load during `next build`. Defer until an answer is requested.
let client: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set — cannot answer");
    client = new OpenAI({ apiKey });
  }
  return client;
}

// AC-3.2 — GPT-4o-mini is the default answer model. temperature 0 keeps answers
// deterministic and tightly bound to the supplied excerpts.
export const ANSWER_MODEL = "gpt-4o-mini";

// Generate a grounded answer from retrieved chunks (AC-3.2/3.3). The caller only
// invokes this when at least one chunk cleared the similarity gate — the no-chunk
// path (AC-3.5) never reaches the model.
export async function generateAnswer(params: {
  question: string;
  chunks: RetrievedChunk[];
  lang: Lang;
}): Promise<string> {
  const openai = getOpenAI();
  const res = await openai.chat.completions.create({
    model: ANSWER_MODEL,
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
