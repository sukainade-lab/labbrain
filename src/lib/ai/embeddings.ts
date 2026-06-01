import OpenAI from "openai";

// Lazy client: OpenAI's constructor throws on a missing key, which would crash
// at module-load during `next build`. Defer until an embedding is requested.
let client: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set — cannot embed");
    client = new OpenAI({ apiKey });
  }
  return client;
}

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIM = 1536;

// OpenAI accepts up to 2048 inputs per embeddings call; stay well under it.
const BATCH_SIZE = 96;

// Embed an ordered list of chunk texts → ordered list of 1536-d vectors (AC-2.3).
// Batched to respect the per-request input cap; order is preserved across batches.
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const openai = getOpenAI();
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
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
