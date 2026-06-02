import { EMBEDDING_DIM, EMBEDDING_MODEL } from "./constants";
import { resolveOpenAiBackend } from "./inference-mode";
import { getOpenAiClient } from "./openai-client";

// Re-export for back-compat with existing importers of these constants.
export { EMBEDDING_MODEL, EMBEDDING_DIM };

// OpenAI accepts up to 2048 inputs per embeddings call; stay well under it.
const BATCH_SIZE = 96;

// Embed an ordered list of chunk texts → ordered list of vectors (AC-2.3). The
// backend (cloud OpenAI vs local Ollama) is resolved per call from INFERENCE_MODE
// (S11/AC-11.2) — in air-gap mode nothing reaches api.openai.com. Batched to respect
// the per-request input cap; order is preserved across batches.
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const backend = resolveOpenAiBackend("embed");
  const client = getOpenAiClient(backend);
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await client.embeddings.create({
      model: backend.model,
      input: batch
    });
    // The API returns objects with an `index` field; sort defensively before push.
    const ordered = [...res.data].sort((a, b) => a.index - b.index);
    for (const item of ordered) out.push(item.embedding as number[]);
  }

  return out;
}

// pgvector ingests a vector literal as the text form `[v1,v2,...]`.
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
