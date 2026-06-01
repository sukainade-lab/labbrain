import type { RetrievedChunk } from "./types";

// AC-3.4 — the citation block shown below an answer. Stored as jsonb on the
// `queries` row (AC-3.7) and rendered as a badge: 📄 [document] — الصفحة [N].
export interface Citation {
  document_id: string;
  document_name: string;
  section: string | null;
  page_number: number | null;
  similarity: number;
}

// Build citations from retrieved chunks, deduped by document+page so two chunks
// from the same page produce one badge. Order (highest similarity first) is
// preserved from the RPC.
export function buildCitations(chunks: RetrievedChunk[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of chunks) {
    const key = `${c.document_id}::${c.page_number ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      document_id: c.document_id,
      document_name: c.document_filename,
      section: c.section,
      page_number: c.page_number,
      similarity: c.similarity
    });
  }
  return out;
}
