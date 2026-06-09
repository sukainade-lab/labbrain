import type { RetrievedChunk } from "./types";

// S17 AC-17.3 — combine the result sets from bilingual (cross-lingual) retrieval.
//
// Each set is an independent, already-tenant-filtered run of match_document_chunks
// (one per query-language embedding). A chunk can surface in more than one set with
// different cosine scores (the original-language and translated-language queries
// score the same passage differently). We union by chunk `id`, keep the **highest**
// similarity seen for each chunk (and the occurrence that earned it), sort by
// similarity descending, and truncate to `limit` — so the merged top-N is exactly
// the best `limit` distinct chunks across both retrievals.
//
// Pure: no I/O, inputs are never mutated.
export function mergeRetrieved(
  resultSets: RetrievedChunk[][],
  limit: number
): RetrievedChunk[] {
  const best = new Map<string, RetrievedChunk>();
  for (const set of resultSets) {
    for (const chunk of set) {
      const existing = best.get(chunk.id);
      if (!existing || chunk.similarity > existing.similarity) {
        best.set(chunk.id, chunk);
      }
    }
  }
  return [...best.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
